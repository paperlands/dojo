const names =  [
    "Nova", "Adam", "Eve", "Helen", "Loki", "Thor", "Rama", "Ares", "Juno", "Iris", "Joan",
    "Orion", "Sky", "Bear", "Fox", "Wolf", "Leaf", "Rain", "Snow", "Dawn", "Dusk", "Leif",
    "Vega", "Mars", "Luna", "Sol", "Rex", "Cato", "Kai", "Thea", "Rhea", "Sokka", "Gaius",
    "Yue", "Lyra", "Kami", "Yi", "Yin", "Yang", "Ryu", "Tsuki", "Qing", "Fuxi", "Uzume",
    "Joe", "Ivy", "Jade", "Ruby", "Sage", "Lin", "Walt", "Ezra", "Yama", "Bolt", "Farza",
    "Star", "Simba", "Lyra", "Puck", "Ariel", "Ursa", "Troy", "Jove", "Abel", "Diana",
    "Atlas", "Cyrus", "Eden", "Fleur", "Horus", "Mizu", "Indy", "Nero", "Pan", "Tony", "Theo",
    "Jose", "Nyx", "Onyx", "Piper", "Aang", "Rune", "Zuko", "Yoda", "Zeus", "Mitra", "Meiji",
    "Paris", "Yale", "Zeph", "Ash", "Remo", "Fred", "Steve", "Echo", "Ame", "Fuji", "Marco",
    "Hal", "Chris", "Jinx", "Homer", "Khan", "Apple", "Hera", "Opal", "Petal", "Iroh",
    "Issac", "Fear", "Shen", "Chang", "Plato", "Feng", "Nike", "Odin", "Momo", "Inari",
    "Alan", "Kay", "Doug", "Elon", "Tesla", "Tom", "Bell", "Ford", "Henry", "Anne", "Rome",
    "Julia", "Meno", "Zeno", "Carl", "Benz", "Otto", "Bach", "Peter", "Paul", "Leo", "Ivan",
    "Akbar", "Ganga", "Indus", "Maya", "Jason", "Merlin", "David", "Karna", "Anand", "Sita"
]

export function idGen(){
  return uuidToBase58(uuidGen())
}

export function uuidGen(){
  return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, c =>
    (+c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> +c / 4).toString(16)
  );
}

const uuidToBase58 = (uuid) => {
  const bytes = uuid.replace(/-/g, '').match(/.{2}/g).map(h => parseInt(h, 16));
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let num = bytes.reduce((acc, byte) => acc * 256n + BigInt(byte), 0n);
  let result = '';
  while (num > 0) {
    result = alphabet[num % 58n] + result;
    num = num / 58n;
  }
  return result || '1';
};

const base58ToUuid = (base58) => {
 const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
 let num = [...base58].reduce((acc, char) => acc * 58n + BigInt(alphabet.indexOf(char)), 0n);
 const bytes = [];
 while (num > 0) {
   bytes.unshift(Number(num % 256n));
   num = num / 256n;
 }
 while (bytes.length < 16) bytes.unshift(0);
 const hex = bytes.map(b => b.toString(16).padStart(2, '0')).join('');
 return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20,32)}`;
};

export function nameGen(){
  let len = names.length
  let indices = Array.from({length: len}, (_, i) => i);
  let currentIndex = 0;

  return function() {
    if (currentIndex%len == 0) {
      // Fisher-Yates shuffle for true randomness
      for (let i = indices.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [indices[i], indices[j]] = [indices[j], indices[i]];
      }
    }
    return names[indices[currentIndex++%len]];
  };
}
