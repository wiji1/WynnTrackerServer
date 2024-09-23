const request = require("request");
const {insertPlayer} = require("./database");

const raids = [
  { name: "All Raids", id: -1 },
  { name: "Nest of the Grootslangs", id: 0 },
  { name: "Orphion's Nexus of Light", id: 1 },
  { name: "The Canyon Colossus", id: 2 },
  { name: "The Nameless Anomaly", id: 3 }
]

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function requestUUID(username) {
  return new Promise((resolve, reject) => {
    const url = `https://api.mojang.com/users/profiles/minecraft/${username}`;

    request(url, function (error, response, body) {
      if (!error && response.statusCode === 200) {
        let data = JSON.parse(body);
        if (data && data.id) {
          let id = data.id.replace(
              /(\w{8})(\w{4})(\w{4})(\w{4})(\w{12})/,
              '$1-$2-$3-$4-$5'
          );
          resolve(id);

          insertPlayer(id, username).catch(err => console.error('Error inserting player:', err));
        } else {
          resolve(null);
        }
      } else {
        console.error('Request failed', error);
        reject(error);
      }
    });
  }).catch(err => {
    console.error('Error in requestUUID:', err);
    return null;
  });
}

module.exports = {sleep, requestUUID, raids};