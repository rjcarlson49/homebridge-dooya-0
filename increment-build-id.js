var fs = require('fs');

//console.log('Incrementing build number...');
fs.readFile('src/metadata.json', (err, content) => {
  if (err) {
    throw err;
  }
  var metadata = JSON.parse(content);
  metadata.build = metadata.build + 1;
  fs.writeFile('src/metadata.json', JSON.stringify(metadata), err => {
    if (err) {
      throw err;
    }
    console.log('Build number: ' + metadata.build);
  });
});