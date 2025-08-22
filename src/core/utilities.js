const request = require("request");

const raids = [
  { name: "All Raids", id: -1 },
  { name: "Nest of the Grootslangs", id: 0 },
  { name: "Orphion's Nexus of Light", id: 1 },
  { name: "The Canyon Colossus", id: 2 },
  { name: "The Nameless Anomaly", id: 3 }
]

const raidsAbbr = [
  { name: "NOTG", id: 0 },
  { name: "NOL", id: 1 },
  { name: "TCC", id: 2 },
  { name: "TNA", id: 3 },
]

const mapping = {
  "healthRegen": "Health Regen %",
  "manaRegen": "Mana Regen",
  "spellDamage": "Spell Damage %",
  "elementalSpellDamage": "Elemental Spell Damage %",
  "neutralSpellDamage": "Neutral Spell Damage %",
  "fireSpellDamage": "Fire Spell Damage %",
  "waterSpellDamage": "Water Spell Damage %",
  "airSpellDamage": "Air Spell Damage %",
  "thunderSpellDamage": "Thunder Spell Damage %",
  "earthSpellDamage": "Earth Spell Damage %",
  "mainAttackDamage": "Main Attack Damage %",
  "elementalMainAttackDamage": "Elemental Main Attack Damage %",
  "neutralMainAttackDamage": "Neutral Main Attack Damage %",
  "fireMainAttackDamage": "Fire Main Attack Damage %",
  "waterMainAttackDamage": "Water Main Attack Damage %",
  "airMainAttackDamage": "Air Main Attack Damage %",
  "thunderMainAttackDamage": "Thunder Main Attack Damage %",
  "earthMainAttackDamage": "Earth Main Attack Damage %",
  "lifeSteal": "Life Steal",
  "manaSteal": "Mana Steal",
  "xpBonus": "XP Bonus %",
  "lootBonus": "Loot Bonus %",
  "leveledXpBonus": "Leveled XP Bonus %",
  "leveledLootBonus": "Leveled Loot Bonus %",
  "reflection": "Reflection",
  "rawStrength": "Strength",
  "rawDexterity": "Dexterity",
  "rawIntelligence": "Intelligence",
  "rawDefence": "Defence",
  "rawAgility": "Agility",
  "thorns": "Thorns %",
  "poison": "Poison",
  "exploding": "Exploding %",
  "walkSpeed": "Walk Speed %",
  "rawAttackSpeed": "Attack Speed",
  "rawHealth": "Health",
  "soulPointRegen": "Soul Point Regen %",
  "stealing": "Stealing %",
  "healthRegenRaw": "Health Regen",
  "rawSpellDamage": "Spell Damage",
  "rawElementalSpellDamage": "Elemental Spell Damage",
  "rawNeutralSpellDamage": "Neutral Spell Damage",
  "rawFireSpellDamage": "Fire Spell Damage",
  "rawWaterSpellDamage": "Water Spell Damage",
  "rawAirSpellDamage": "Air Spell Damage",
  "rawThunderSpellDamage": "Thunder Spell Damage",
  "rawEarthSpellDamage": "Earth Spell Damage",
  "rawMainAttackDamage": "Main Attack Damage",
  "rawElementalMainAttackDamage": "Elemental Main Attack Damage",
  "rawNeutralMainAttackDamage": "Neutral Main Attack Damage",
  "rawFireMainAttackDamage": "Fire Main Attack Damage",
  "rawWaterMainAttackDamage": "Water Main Attack Damage ",
  "rawAirMainAttackDamage": "Air Main Attack Damage",
  "rawThunderMainAttackDamage": "Thunder Main Attack Damage",
  "rawEarthMainAttackDamage": "Earth Main Attack Damage",
  "damage": "Damage %",
  "neutralDamage": "Damage",
  "fireDamage": "Fire Damage",
  "waterDamage": "Water Damage",
  "airDamage": "Air Damage",
  "thunderDamage": "Thunder Damage",
  "earthDamage": "Earth Damage",
  "elementalDamage": "Elemental Damage %",
  "rawDamage": "Damage",
  "rawNeutralDamage": "Neutral Damage",
  "rawFireDamage": "Fire Damage",
  "rawWaterDamage": "Water Damage",
  "rawAirDamage": "Air Damage",
  "rawThunderDamage": "Thunder Damage",
  "rawEarthDamage": "Earth Damage",
  "rawElementalDamage": "Elemental Damage",
  "fireDefence": "Fire Defence %",
  "waterDefence": "Water Defence %",
  "airDefence": "Air Defence %",
  "thunderDefence": "Thunder Defence %",
  "earthDefence": "Earth Defence %",
  "elementalDefence": "Elemental Defence %",
  "1stSpellCost": "1st Spell Cost %",
  "raw1stSpellCost": "1st Spell Cost",
  "2ndSpellCost": "2nd Spell Cost %",
  "raw2ndSpellCost": "2nd Spell Cost",
  "3rdSpellCost": "3rd Spell Cost %",
  "raw3rdSpellCost": "3rd Spell Cost",
  "4thSpellCost": "4th Spell Cost %",
  "raw4thSpellCost": "4th Spell Cost",
  "sprint": "Sprint %",
  "sprintRegen": "Sprint Regen %",
  "jumpHeight": "Jump Height",
  "lootQuality": "Loot Quality %",
  "gatherXpBonus": "Gather XP Bonus %",
  "gatherSpeed": "Gather Speed %",
  "healingEfficiency": "Healing Efficiency %",
  "knockback": "Knockback %",
  "weakenEnemy": "Weaken Enemy %",
  "slowEnemy": "Slow Enemy %",
  "elementalDefence": "Elemental Defence %",
  "damageFromMobs": "Damage From Mobs %",
  "maxMana": "Max Mana %",
  "rawMaxMana": "Max Mana",
  "mainAttackRange": "Main Attack Range",
  "criticalDamageBonus": "Critical Damage Bonus"
};

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function daysToTimestamp(days) {
  if (days <= 0) return null;

  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function getLastPoolReset(weeksAgo = 0) {
  const date = new Date();
  date.setUTCHours(17, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 2) % 7 - (weeksAgo * 7));

  return date.toISOString().slice(0, 19).replace('T', ' ');
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
          resolve({ uuid: id, name: data.name });

          // Dynamically import to avoid circular dependency
          setImmediate(async () => {
            try {
              const { insertPlayer } = require("./database");
              await insertPlayer(id, data.name); // Use data.name for capitalized username
            } catch (err) {
              console.error('Error inserting player:', err);
            }
          });
        } else {
          resolve(null);
        }
      } else {
        console.error('Mojang request failed', response.statusMessage);
        reject(error);
      }
    });
  }).catch(err => {
    console.error('Error in requestUUID:', err);
    return null;
  });
}

async function requestUsername(uuid) {
  const cleanUUID = uuid.replace(/-/g, '');
  const url = `https://sessionserver.mojang.com/session/minecraft/profile/${cleanUUID}`;

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data.name || null;
  } catch (err) {
    console.error('Error fetching username:', err);
    return null;
  }
}

function requestItemAnalysis(item) {
  return new Promise((resolve, reject) => {
    const options = {
        url: `https://nori.fish/api/item/analysis`,
        method: `POST`,
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            encoded_item: `${item}`
        })
    };
    request(options, function (error, response, body) {
      if (!error && response.statusCode === 200) {
        try{
          let data = JSON.parse(body);

          function mapObjectKeys(obj, mapping) {
            const mappedObj = {};
            for (const [key, value] of Object.entries(obj)) {
              const readableName = mapping[key] || key;
              mappedObj[readableName] = value;
            }
            return mappedObj;
          }

          const itemName = Object.keys(data.Result)[0];
          const itemStats = data.Result[itemName];
          const rate = data.Result.rate;
          const reroll = data.Result.misc.reroll;
          const internalName = data.Result.internalName;
          const tier = data.Result.item_tier;
          const shiny = data.Result.shiny;
          const mappedStats = mapObjectKeys(itemStats, mapping);
          const mappedRate = mapObjectKeys(rate, mapping);

          const extractedData = {
              itemName: itemName,
              stats: mappedStats,
              rate: mappedRate,
              reroll: reroll,
              internalName: internalName,
              tier,
              shiny: shiny
          };
          resolve(extractedData);
        } catch (err) {
          console.error('Error decoding item:', err);
          reject(err)
        }
      } else {
        console.error('Nori API request failed:', error);
      }
    });
  });
}
module.exports = {sleep, requestUUID, requestUsername, raids, daysToTimestamp, getLastPoolReset, requestItemAnalysis};