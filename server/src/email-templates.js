function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function headerText(value) {
  return String(value || "")
    .replace(/[\r\n\x00-\x1f\x7f]/g, " ")
    .trim()
    .slice(0, 120);
}

function displayValue(value) {
  if (value === null || value === undefined || value === "") return "Not provided";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function dateText(value) {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? "Not available" : date.toLocaleString("en-GB", { timeZone: "Asia/Qatar" });
}

function renderEmail(eventType, data = {}) {
  const restaurantName = headerText(data.restaurantName) || "Restaurant";
  let title;
  let subject;
  let lines;

  if (eventType === "PARTNER_REGISTRATION_SUBMITTED") {
    title = "New restaurant application";
    subject = `[KABHI] Restaurant application: ${restaurantName}`;
    lines = [
      "A new restaurant application requires review.",
      `Restaurant: ${restaurantName}`,
      `Owner: ${displayValue(data.ownerName)}`,
      `Registered email: ${displayValue(data.email)}`,
      `Registration date: ${dateText(data.date)}`,
      `Approval status: ${displayValue(data.status)}`,
      `Registration ID: ${displayValue(data.registrationId)}`
    ];
    if (data.dashboardUrl) lines.push(`Admin dashboard: ${data.dashboardUrl}`);
  } else if (eventType === "PARTNER_REGISTRATION_APPROVED") {
    title = "Restaurant application approved";
    subject = `[KABHI] ${restaurantName} application approved`;
    lines = [
      `The application for ${restaurantName} has been approved.`,
      `Application status: ${displayValue(data.status)}`,
      `Restaurant setup status: ${displayValue(data.restaurantStatus)}`,
      `Approval date: ${dateText(data.date)}`,
      "Next step: use the activation link shared by KABHI to create your restaurant account, then complete menu and restaurant setup."
    ];
  } else if (eventType === "PARTNER_REGISTRATION_REJECTED") {
    title = "Restaurant application update";
    subject = `[KABHI] ${restaurantName} application update`;
    lines = [
      `The application for ${restaurantName} has been rejected.`,
      `Application status: ${displayValue(data.status)}`,
      `Review date: ${dateText(data.date)}`
    ];
    if (data.reason) lines.push(`Reason: ${displayValue(data.reason)}`);
    lines.push(data.correctionAllowed
      ? "Corrections have been requested. Use your registration access link to update and resubmit the application."
      : "Contact KABHI support if you have questions about this decision.");
  } else if (eventType === "RESTAURANT_STATUS_CHANGED") {
    if (data.status === "APPROVED") {
      title = "Restaurant approved";
      subject = `[KABHI] ${restaurantName} approved`;
      lines = [
        `The restaurant ${restaurantName} has been approved.`,
        `Approval status: ${displayValue(data.status)}`,
        `Approval date: ${dateText(data.date)}`,
        "Next steps: You can now configure your menu, operational hours, and start accepting customer orders in the restaurant dashboard."
      ];
      if (data.reason) lines.push(`Note: ${displayValue(data.reason)}`);
    } else if (data.status === "REJECTED") {
      title = "Restaurant application rejected";
      subject = `[KABHI] ${restaurantName} rejected`;
      lines = [
        `The application for ${restaurantName} has been rejected.`,
        `Current status: ${displayValue(data.status)}`,
        `Review date: ${dateText(data.date)}`
      ];
      if (data.reason) lines.push(`Reason: ${displayValue(data.reason)}`);
      lines.push("Contact KABHI support if you have questions about this decision.");
    } else {
      title = "Restaurant status update";
      subject = `[KABHI] ${restaurantName} status update`;
      lines = [
        `The status of ${restaurantName} was updated.`,
        `Previous status: ${displayValue(data.previousStatus)}`,
        `Current status: ${displayValue(data.status)}`,
        `Change date: ${dateText(data.date)}`,
        ...changeLines(data.changes)
      ];
      if (data.reason) lines.push(`Reason: ${displayValue(data.reason)}`);
    }
  } else if (eventType === "DELIVERY_RADIUS_UPDATED") {
    title = "Restaurant delivery radius updated";
    subject = `[KABHI] ${restaurantName} delivery radius updated`;
    lines = [
      `The delivery radius for ${restaurantName} was updated by ${displayValue(data.actor)}.`,
      `Change date: ${dateText(data.date)}`,
      `Delivery radius: ${displayValue(data.previousRadius)} km → ${displayValue(data.radius)} km`
    ];
    if (data.reason) lines.push(`Reason: ${displayValue(data.reason)}`);
  } else if (eventType === "RESTAURANT_UPDATED") {
    const isRadiusOnly = data.changes?.length === 1 && /radius/i.test(data.changes[0].label);
    title = isRadiusOnly ? "Restaurant delivery radius updated" : "Restaurant settings updated";
    subject = isRadiusOnly ? `[KABHI] ${restaurantName} delivery radius updated` : `[KABHI] ${restaurantName} settings updated`;
    lines = [
      `Restaurant settings for ${restaurantName} were updated by ${displayValue(data.actor)}.`,
      `Change date: ${dateText(data.date)}`,
      ...changeLines(data.changes)
    ];
  } else if (eventType === "MENU_UPDATED") {
    title = "Restaurant menu updated";
    subject = `[KABHI] ${restaurantName} menu update`;
    lines = [
      `The menu for ${restaurantName} was updated by ${displayValue(data.actor)}.`,
      `Change date: ${dateText(data.date)}`,
      ...menuLines(data)
    ];
  } else {
    throw new Error(`Unknown email notification type: ${eventType}`);
  }

  const html = [
    "<!doctype html><html><body style=\"font-family:Arial,sans-serif;color:#202124;line-height:1.5\">",
    `<h2 style="color:#176b52">${escapeHtml(title)}</h2>`,
    "<ul>",
    ...lines.map((line) => `<li>${escapeHtml(line)}</li>`),
    "</ul>",
    "<p>KABHI</p>",
    "</body></html>"
  ].join("");

  return { subject, text: lines.join("\n"), html };
}

function changeLines(changes = []) {
  return changes.map(({ label, previous, next }) =>
    `${label}: ${displayValue(previous)} → ${displayValue(next)}`
  );
}

function menuLines(data) {
  if (Array.isArray(data.items)) {
    const lines = [];
    if (data.summary) {
      lines.push(`Summary: ${data.summary.added || 0} added, ${data.summary.updated || 0} updated, ${data.summary.removed || 0} removed.`);
    }
    lines.push(...data.items.slice(0, 25).map((item) => {
      const details = item.changes?.length
        ? ` (${item.changes.map(({ label, previous, next }) =>
          `${label}: ${displayValue(previous)} → ${displayValue(next)}`
        ).join("; ")})`
        : "";
      return `${item.action}: ${displayValue(item.name)}${details}`;
    }));
    if (data.items.length > 25) lines.push(`And ${data.items.length - 25} more menu item changes.`);
    return lines.length ? lines : ["No menu item details were available."];
  }

  return [
    `Action: ${displayValue(data.action)}`,
    `Menu item: ${displayValue(data.itemName)}`,
    ...changeLines(data.changes)
  ];
}

module.exports = { renderEmail, escapeHtml };
