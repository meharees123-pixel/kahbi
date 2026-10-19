const ExcelJS = require("exceljs");
const { Readable } = require("node:stream");
const yauzl = require("yauzl");

const MAX_MENU_ROWS = 500;
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const MENU_HEADERS = [
  "Category",
  "Item Name",
  "Description",
  "Price",
  "Availability Start (HH:MM)",
  "Availability End (HH:MM)",
  "Image URL (Optional)"
];

function cellText(value, numberFormat = "") {
  if (value === null || value === undefined) return "";
  if (typeof value === "number" && /h{1,2}:m{1,2}/i.test(numberFormat) && value >= 0 && value < 1) {
    const minutes = Math.round(value * 24 * 60) % (24 * 60);
    return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  }
  if (value instanceof Date) {
    return `${String(value.getUTCHours()).padStart(2, "0")}:${String(value.getUTCMinutes()).padStart(2, "0")}`;
  }
  if (typeof value === "object") {
    if (value.formula || value.sharedFormula) return "";
    if (Array.isArray(value.richText)) return value.richText.map((part) => part.text || "").join("").trim();
    if (value.text !== undefined) return String(value.text).trim();
    return "";
  }
  return String(value).trim();
}

function canonicalHeader(value) {
  return cellText(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

async function parseMenuFile(file) {
  const extension = String(file.originalname || "").toLowerCase().split(".").pop();
  if (!["csv", "xlsx"].includes(extension)) {
    return { error: "Choose an Excel .xlsx or CSV .csv menu file." };
  }

  const workbook = new ExcelJS.Workbook();
  try {
    if (extension === "xlsx") {
      await workbook.xlsx.load(file.buffer);
    } else {
      await workbook.csv.read(Readable.from(file.buffer));
    }
  } catch (_) {
    return { error: "The menu file could not be read. Check that it is a valid .xlsx or .csv file." };
  }

  const sheet = workbook.worksheets[0];
  if (!sheet || sheet.rowCount < 2) return { error: "The file must contain a header row and at least one menu item." };
  const headerRow = sheet.getRow(1);
  const headerPositions = new Map();
  headerRow.eachCell({ includeEmpty: false }, (cell, column) => {
    const key = canonicalHeader(cell.value);
    if (key) headerPositions.set(key, column);
  });
  const aliases = {
    description: ["description", "itemdescription"],
    price: ["price", "priceqar"],
    availabilityStart: ["availabilitystarthhmm", "availabilitystart"],
    availabilityEnd: ["availabilityendhhmm", "availabilityend"],
    imageUrl: ["imageurloptional", "imageurl"],
    itemId: ["itemid"],
    restaurantId: ["restaurantid"]
  };
  const findColumn = (field) => (aliases[field] || [canonicalHeader(field)]).map((alias) => headerPositions.get(alias)).find(Boolean);
  const requiredHeaders = ["category", "itemname", "price"];
  const missingHeaders = requiredHeaders.filter((header) => !headerPositions.has(header));
  if (missingHeaders.length) {
    return { error: `Missing required column${missingHeaders.length > 1 ? "s" : ""}: ${missingHeaders.map((header) => MENU_HEADERS.find((name) => canonicalHeader(name) === header)).join(", ")}.` };
  }

  const rows = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const value = (field) => {
      const column = findColumn(field);
      return column ? cellText(row.getCell(column).value, row.getCell(column).numFmt) : "";
    };
    const parsed = {
      category: value("category"),
      name: value("itemname"),
      description: value("description"),
      price: value("price"),
      availabilityStart: value("availabilityStart"),
      availabilityEnd: value("availabilityEnd"),
      imageUrl: value("imageUrl"),
      itemId: value("itemId"),
      restaurantId: value("restaurantId")
    };
    if (Object.values(parsed).some(Boolean)) rows.push({ rowNumber, values: parsed });
  });
  if (rows.length > MAX_MENU_ROWS) return { error: `Upload no more than ${MAX_MENU_ROWS} menu rows at a time.` };
  if (!rows.length) return { error: "The file does not contain any menu items." };
  return { rows };
}

function validateMenuRows(inputRows, restaurantId) {
  if (!Array.isArray(inputRows) || inputRows.length < 1 || inputRows.length > MAX_MENU_ROWS) {
    return { error: `Upload between 1 and ${MAX_MENU_ROWS} menu items at a time.` };
  }
  const seen = new Map();
  const rows = inputRows.map((source, index) => {
    const errors = [];
    const values = source && typeof source === "object" && !Array.isArray(source) ? source : {};
    const rowNumber = Number.isInteger(Number(values.rowNumber)) && Number(values.rowNumber) >= 2
      ? Number(values.rowNumber)
      : index + 2;
    const restaurantValue = String(values.restaurantId ?? values["Restaurant ID"] ?? "").trim();
    const itemId = String(values.itemId ?? values["Item ID"] ?? "").trim();
    const category = String(values.category ?? values.Category ?? "").trim();
    const name = String(values.name ?? values.itemName ?? values["Item Name"] ?? "").trim();
    const description = String(values.description ?? values["Item Description"] ?? "").trim();
    const rawPrice = values.price ?? values["Price (QAR)"];
    const rawDiscount = values.discountPrice ?? values["Discount Price (QAR)"];
    const rawFoodType = values.foodType ?? values["Food Type"];
    const rawPreparation = values.preparationMinutes ?? values["Preparation Time"];
    const rawAvailability = values.availability ?? values.Availability;
    const imageUrl = String(values.imageUrl ?? values["Image URL"] ?? "").trim();
    const availabilityStart = String(values.availabilityStart ?? values["Availability Start (HH:MM)"] ?? "").trim();
    const availabilityEnd = String(values.availabilityEnd ?? values["Availability End (HH:MM)"] ?? "").trim();
    const customizationOptions = String(values.customizationOptions ?? values["Customization Options"] ?? "").trim();
    const price = rawPrice === "" || rawPrice === null || rawPrice === undefined ? NaN : Number(rawPrice);
    const discountPrice = rawDiscount === "" || rawDiscount === null || rawDiscount === undefined
      ? null
      : Number(rawDiscount);
    const preparationMinutes = rawPreparation === "" || rawPreparation === null || rawPreparation === undefined
      ? null
      : Number(rawPreparation);
    const foodType = String(rawFoodType || "").trim().toUpperCase();
    const availabilityText = String(rawAvailability || "").trim().toUpperCase();
    const availabilityMap = { AVAILABLE: "AVAILABLE", UNAVAILABLE: "UNAVAILABLE" };
    const foodTypeMap = {
      VEGETARIAN: "VEGETARIAN",
      "NON-VEGETARIAN": "NON_VEGETARIAN",
      NONVEGETARIAN: "NON_VEGETARIAN",
      NON_VEGETARIAN: "NON_VEGETARIAN",
      VEGAN: "VEGAN"
    };

    if (restaurantValue && restaurantValue !== String(restaurantId)) errors.push("Restaurant ID does not match your account.");
    if (!category || category.length > 80) errors.push("Category is required (maximum 80 characters).");
    if (!name || name.length > 120) errors.push("Item Name is required (maximum 120 characters).");
    if (!Number.isFinite(price) || price <= 0 || price > 100000) errors.push("Price (QAR) must be greater than 0 and no more than 100,000.");
    if (discountPrice !== null && (!Number.isFinite(discountPrice) || discountPrice < 0 || discountPrice >= price)) {
      errors.push("Discount Price must be 0 or more and less than the regular price.");
    }
    if (foodType && !foodTypeMap[foodType]) errors.push("Food Type must be Vegetarian, Non-Vegetarian, or Vegan.");
    if (availabilityText && !availabilityMap[availabilityText]) errors.push("Availability must be Available or Unavailable.");
    if ((availabilityStart && !availabilityEnd) || (!availabilityStart && availabilityEnd)) {
      errors.push("Enter both availability start and end times, or leave both blank.");
    }
    if ((availabilityStart && !TIME_PATTERN.test(availabilityStart)) || (availabilityEnd && !TIME_PATTERN.test(availabilityEnd))) {
      errors.push("Availability times must use 24-hour HH:MM format.");
    } else if (availabilityStart && availabilityEnd && availabilityStart === availabilityEnd) {
      errors.push("Availability start and end times cannot be the same.");
    }
    if (preparationMinutes !== null && (!Number.isInteger(preparationMinutes) || preparationMinutes < 1 || preparationMinutes > 720)) {
      errors.push("Preparation Time must be a whole number from 1 to 720 minutes.");
    }
    if (description.length > 1000) errors.push("Item Description must be 1,000 characters or fewer.");
    if (itemId.length > 100) errors.push("Item ID must be 100 characters or fewer.");
    if (customizationOptions.length > 1000) errors.push("Customization Options must be 1,000 characters or fewer.");
    if (imageUrl.length > 2048) errors.push("Image URL must be 2,048 characters or fewer.");
    if (imageUrl) {
      try {
        const url = new URL(imageUrl);
        if (url.protocol !== "https:" || !url.hostname) throw new Error("invalid");
      } catch (_) {
        errors.push("Image URL must be a valid HTTPS URL.");
      }
    }

    const identities = [
      ...(itemId ? [`id:${itemId.toLowerCase()}`] : []),
      ...(category && name ? [`name:${category.toLowerCase()}|${name.toLowerCase()}`] : [])
    ];
    const duplicateRow = identities.map((identity) => seen.get(identity)).find(Boolean);
    if (duplicateRow) {
      errors.push(`Duplicate menu item in this file (first listed on row ${duplicateRow}).`);
    } else {
      for (const identity of identities) seen.set(identity, rowNumber);
    }

    return {
      rowNumber,
      restaurantId: String(restaurantId),
      itemId,
      category,
      name,
      description,
      price,
      discountPrice,
      foodType: foodTypeMap[foodType] || "",
      preparationMinutes,
      availability: availabilityMap[availabilityText] || "AVAILABLE",
      availabilityStart,
      availabilityEnd,
      imageUrl,
      customizationOptions,
      errors
    };
  });
  return { rows, validCount: rows.filter((row) => !row.errors.length).length, invalidCount: rows.filter((row) => row.errors.length).length };
}

function isMenuItemWithinAvailability(item, now = new Date()) {
  const start = String(item.availabilityStart || "");
  const end = String(item.availabilityEnd || "");
  if (!start && !end) return true;
  if (!TIME_PATTERN.test(start) || !TIME_PATTERN.test(end) || start === end) return false;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Qatar",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  const current = `${values.hour}:${values.minute}`;
  return start < end
    ? current >= start && current < end
    : current >= start || current < end;
}

function csvCell(value) {
  let text = String(value ?? "");
  if (/^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function rowsToCsv(rows, headers) {
  return [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
}

function parseImageArchive(buffer) {
  return new Promise((resolve) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true, validateEntrySizes: true }, (openError, archive) => {
      if (openError) return resolve({ error: "The ZIP file could not be read. Check that it is a valid ZIP archive." });
      const images = [];
      let uncompressedTotal = 0;
      let finished = false;
      const finish = (result) => {
        if (finished) return;
        finished = true;
        archive.close();
        resolve(result);
      };
      archive.on("error", () => finish({ error: "The ZIP file could not be read safely." }));
      archive.on("end", () => finish({ images }));
      archive.on("entry", (entry) => {
        const name = String(entry.fileName || "");
        if (name.endsWith("/")) return archive.readEntry();
        const baseName = name.split(/[\\/]/).pop() || "";
        const extension = baseName.toLowerCase().split(".").pop();
        const mimeType = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" }[extension];
        const mode = (entry.externalFileAttributes >>> 16) & 0o170000;
        if (!mimeType || mode === 0o120000) return archive.readEntry();
        if (images.length >= MAX_MENU_ROWS || entry.uncompressedSize > 256 * 1024 ||
            uncompressedTotal + entry.uncompressedSize > 20 * 1024 * 1024) {
          return finish({ error: "The ZIP contains too many images or an image exceeds the 256 KB per-image limit." });
        }
        uncompressedTotal += entry.uncompressedSize;
        archive.openReadStream(entry, (streamError, stream) => {
          if (streamError) return finish({ error: "An image in the ZIP could not be read." });
          const chunks = [];
          let size = 0;
          stream.on("data", (chunk) => {
            size += chunk.length;
            if (size > 256 * 1024) {
              stream.destroy();
              return finish({ error: "An image in the ZIP exceeds the 256 KB per-image limit." });
            }
            chunks.push(chunk);
          });
          stream.on("error", () => finish({ error: "An image in the ZIP could not be read." }));
          stream.on("end", () => {
            images.push({ fileName: baseName, mimeType, buffer: Buffer.concat(chunks) });
            archive.readEntry();
          });
        });
      });
      archive.readEntry();
    });
  });
}

module.exports = {
  MAX_MENU_ROWS,
  MENU_HEADERS,
  parseMenuFile,
  parseImageArchive,
  validateMenuRows,
  isMenuItemWithinAvailability,
  rowsToCsv
};
