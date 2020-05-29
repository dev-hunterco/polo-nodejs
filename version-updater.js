const currentVersion = process.env.TRAVIS_TAG || 'next'
const fs = require('fs');
console.log('Updating package.json to version:', currentVersion)

const currentContent = require('./package.json')

currentContent.version = currentVersion

fs.writeFile("./new-package.json", JSON.stringify(currentContent, null, 2), function(err) {
  if (err) {
    console.log(`Error saving file ${file}:`, err);
    process.exit(1)
  }
});
