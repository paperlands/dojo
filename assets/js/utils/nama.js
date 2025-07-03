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

export function nameGen() {
  let indices = Array.from({length: names.length}, (_, i) => i);
  let currentIndex = 0;

  return function() {
    if (currentIndex >= indices.length) {
      // Fisher-Yates shuffle for true randomness
      for (let i = indices.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [indices[i], indices[j]] = [indices[j], indices[i]];
      }
      currentIndex = 0;
    }

    return names[indices[currentIndex++]];
  };
}
