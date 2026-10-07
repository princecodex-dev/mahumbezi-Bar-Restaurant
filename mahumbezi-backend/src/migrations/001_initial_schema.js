const fs = require("fs");
const path = require("path");

module.exports = {
  up(db) {
    const schema = fs.readFileSync(path.join(__dirname, "..", "schema.sql"), "utf8");
    db.exec(schema);
  },
};
