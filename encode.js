// encode.js
const fs = require("fs");
const key = fs.readFileSync("./config/my-project-client-side-firebase-adminsdk-fbsvc-0ce34b0f8f.json", "utf8");
const base64 = Buffer.from(key).toString("base64");
console.log(base64);