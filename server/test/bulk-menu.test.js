const test = require("node:test");
const assert = require("node:assert/strict");
const ExcelJS = require("exceljs");
const {
  MENU_HEADERS, parseImageArchive, parseMenuFile, validateMenuRows, isMenuItemWithinAvailability
} = require("../src/bulk-menu");

const restaurantId = "65a111111111111111111111";
const fullMenuRow = {
  category: "Main Course",
  name: "Chicken Biryani",
  description: "Spiced rice",
  price: 25,
  availabilityStart: "",
  availabilityEnd: "",
  imageUrl: ""
};

function menuRow(overrides = {}) {
  return {
    restaurantId,
    itemId: "",
    category: "Main Course",
    name: "Chicken Biryani",
    description: "Spiced rice",
    price: 25,
    discountPrice: 20,
    foodType: "Non-Vegetarian",
    preparationMinutes: 25,
    availability: "Available",
    imageUrl: "https://images.example.test/biryani.jpg",
    customizationOptions: "Extra spicy",
    ...fullMenuRow,
    ...overrides
  };
}

test("bulk menu validator accepts valid Qatar menu rows and normalizes options", () => {
  const result = validateMenuRows([{ ...menuRow(), rowNumber: 2 }], restaurantId);
  assert.equal(result.validCount, 1);
  assert.equal(result.invalidCount, 0);
  assert.equal(result.rows[0].foodType, "NON_VEGETARIAN");
  assert.equal(result.rows[0].availability, "AVAILABLE");
});

test("bulk menu validator reports required, invalid, cross-restaurant, and duplicate rows", () => {
  const result = validateMenuRows([
    { ...menuRow({ restaurantId: "another-restaurant", name: "Bad Dish", price: -1, foodType: "Meat", availability: "Ready", imageUrl: "javascript:alert(1)" }), rowNumber: 2 },
    { ...menuRow(), rowNumber: 3 },
    { ...menuRow(), rowNumber: 4 }
  ], restaurantId);
  assert.equal(result.validCount, 1);
  assert.equal(result.invalidCount, 2);
  assert.match(result.rows[0].errors.join(" "), /Restaurant ID/);
  assert.match(result.rows[0].errors.join(" "), /Price/);
  assert.match(result.rows[0].errors.join(" "), /Food Type/);
  assert.match(result.rows[0].errors.join(" "), /Availability/);
  assert.match(result.rows[0].errors.join(" "), /HTTPS/);
  assert.match(result.rows[2].errors.join(" "), /Duplicate/);
});

test("CSV template headers and contents parse into preview rows", async () => {
  assert.deepEqual(MENU_HEADERS, [
    "Category",
    "Item Name",
    "Description",
    "Price",
    "Availability Start (HH:MM)",
    "Availability End (HH:MM)",
    "Image URL (Optional)"
  ]);
  const row = ["Starters", "Hummus", "Classic hummus", "18", "09:00", "22:00", ""];
  const csv = [MENU_HEADERS, row].map((cells) => cells.map((value) => `"${value}"`).join(",")).join("\r\n");
  const parsed = await parseMenuFile({ originalname: "menu.csv", buffer: Buffer.from(csv) });
  assert.equal(parsed.rows.length, 1);
  const result = validateMenuRows(parsed.rows.map(({ rowNumber, values }) => ({ ...values, rowNumber })), restaurantId);
  assert.equal(result.validCount, 1);
  assert.equal(result.rows[0].availabilityStart, "09:00");
  assert.equal(result.rows[0].availabilityEnd, "22:00");
  assert.equal(result.rows[0].discountPrice, null);
});

test("Excel .xlsx files parse using the standard template columns", async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Menu");
  sheet.addRow(MENU_HEADERS);
  const row = sheet.addRow(["Beverages", "Karak Tea", "", 6, 9 / 24, 22 / 24, ""]);
  row.getCell(5).numFmt = "hh:mm";
  row.getCell(6).numFmt = "hh:mm";
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  const parsed = await parseMenuFile({ originalname: "menu.xlsx", buffer });
  assert.equal(parsed.rows.length, 1);
  const result = validateMenuRows(parsed.rows.map(({ rowNumber, values }) => ({ ...values, rowNumber })), restaurantId);
  assert.equal(result.validCount, 1);
  assert.equal(result.rows[0].name, "Karak Tea");
  assert.equal(result.rows[0].availabilityStart, "09:00");
  assert.equal(result.rows[0].availabilityEnd, "22:00");
});

test("bulk menu parser rejects wrong extensions and missing mandatory columns", async () => {
  assert.match((await parseMenuFile({ originalname: "menu.txt", buffer: Buffer.from("data") })).error, /Choose an Excel/);
  const parsed = await parseMenuFile({ originalname: "menu.csv", buffer: Buffer.from("Category,Item Name\nMain Course,Rice") });
  assert.match(parsed.error, /Missing required column/);
});

test("bulk menu validator accepts normalized food types when preview rows are re-submitted", () => {
  const result = validateMenuRows([{ ...menuRow({ foodType: "NON_VEGETARIAN" }), rowNumber: 2 }], restaurantId);
  assert.equal(result.validCount, 1);
  assert.equal(result.rows[0].foodType, "NON_VEGETARIAN");
});

test("ZIP image parser rejects malformed archives and safely reads supported ZIP containers", async () => {
  assert.match((await parseImageArchive(Buffer.from("not a zip"))).error, /valid ZIP/);
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet("Menu").addRow(["not an image"]);
  const zipBuffer = Buffer.from(await workbook.xlsx.writeBuffer());
  const parsed = await parseImageArchive(zipBuffer);
  assert.deepEqual(parsed.images, []);
});

test("bulk menu availability requires paired valid start and end times", () => {
  const missingPair = validateMenuRows([{ ...fullMenuRow, availabilityStart: "09:00" }], restaurantId);
  assert.match(missingPair.rows[0].errors.join(" "), /both availability start and end/);
  const invalidTime = validateMenuRows([{ ...fullMenuRow, availabilityStart: "9:00", availabilityEnd: "22:00" }], restaurantId);
  assert.match(invalidTime.rows[0].errors.join(" "), /24-hour HH:MM/);
  const sameTime = validateMenuRows([{ ...fullMenuRow, availabilityStart: "09:00", availabilityEnd: "09:00" }], restaurantId);
  assert.match(sameTime.rows[0].errors.join(" "), /cannot be the same/);
});

test("menu time windows use Qatar time and support overnight availability", () => {
  const item = { availabilityStart: "09:00", availabilityEnd: "17:00" };
  assert.equal(isMenuItemWithinAvailability(item, new Date("2026-10-19T06:00:00.000Z")), true);
  assert.equal(isMenuItemWithinAvailability(item, new Date("2026-10-19T15:00:00.000Z")), false);
  const overnight = { availabilityStart: "22:00", availabilityEnd: "02:00" };
  assert.equal(isMenuItemWithinAvailability(overnight, new Date("2026-10-19T22:30:00.000Z")), true);
  assert.equal(isMenuItemWithinAvailability(overnight, new Date("2026-10-19T00:30:00.000Z")), false);
});
