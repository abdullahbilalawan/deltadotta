import { readFileSync, writeFileSync } from "node:fs";

const reviewPath = ".deltadotta/onboarding/review/organization.review.json";
const review = JSON.parse(readFileSync(reviewPath, "utf8"));

review.reviewedBy = "Jordan Lee, General Manager";
review.reviewedAt = "2026-08-01T12:00:00.000Z";
review.organization.roles.forEach((role) => {
  role.confirmed = true;
});
review.organization.ingestionWarnings.forEach((warning) => {
  warning.acknowledged = true;
});

writeFileSync(reviewPath, `${JSON.stringify(review, null, 2)}\n`);

