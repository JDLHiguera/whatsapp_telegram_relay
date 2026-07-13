const fs = require("fs");
const path = require("path");

try {
  console.log("Reading downloaded ./api.tl...");
  const newSchema = fs.readFileSync(path.join(__dirname, "api.tl"), "utf8");

  // Path to apiTl.js
  const apiTlPath = path.join(__dirname, "node_modules", "telegram", "tl", "apiTl.js");
  console.log(`Updating ${apiTlPath}...`);
  
  // Format the file contents as module.exports = `[schema]`;
  const escapedSchema = newSchema.replace(/`/g, "\\`").replace(/\${/g, "\\${");
  const apiTlContent = `"use strict";\nmodule.exports = \`${escapedSchema}\`;\n`;
  
  fs.writeFileSync(apiTlPath, apiTlContent, "utf8");
  console.log("✅ apiTl.js updated successfully!");

  // Path to AllTLObjects.js
  const allTLObjectsPath = path.join(__dirname, "node_modules", "telegram", "tl", "AllTLObjects.js");
  console.log(`Updating LAYER in ${allTLObjectsPath}...`);
  let allTLObjectsContent = fs.readFileSync(allTLObjectsPath, "utf8");
  
  // Replace exports.LAYER = 198; with exports.LAYER = 228;
  allTLObjectsContent = allTLObjectsContent.replace(
    /exports\.LAYER\s*=\s*\d+;/,
    "exports.LAYER = 228;"
  );
  
  fs.writeFileSync(allTLObjectsPath, allTLObjectsContent, "utf8");
  console.log("✅ AllTLObjects.js LAYER updated to 228!");

} catch (error) {
  console.error("❌ Patching failed:", error);
}
