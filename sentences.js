// Practice sentences for the "In a sentence" clue. Shared by the app and the clip generator (tools/clips),
// so the recorded audio always matches the text the child sees.
//
// The sentence for each word lives in words.json (the `sentence` field). The hand-written list and the
// templates below are only a fallback for a word that does not have one yet (for example a word just added).
const curated = {
  'school':'A school of fish swam past the reef.', 'guy':'A strong guy rope kept the tent steady.',
  'mole':'We enjoyed enchiladas covered in mole sauce.', 'calypso':'The rare calypso orchid bloomed in the forest.',
  'kona':'The kona wind brought warm air across the island.',
  'learned':'The learned scientist studied ancient languages.',
  'dogged':'Her dogged effort helped her finish the difficult puzzle.',
  'pizza':'We shared a slice of pizza after the game.',
  'zucchini':'The gardener picked a fresh zucchini for dinner.',
  'xylophone':'Maya played a cheerful song on the xylophone.',
  'democracy':'The class held a vote to understand democracy.',
  'algorithm':'The robot followed an algorithm to find the maze exit.',
  'biopsy':'The doctor used a biopsy to examine a small tissue sample.',
  'amulet':'The traveler carried an amulet in a tiny pouch.',
  'sushi':'The chef rolled sushi with rice and vegetables.',
  'noodle':'A long noodle slipped off my fork.',
  'robot':'The robot carried supplies across the room.',
  'ballet':'She practiced ballet before the recital.',
  'tornado':'The tornado moved across the empty field.',
  'jalapeño':'A jalapeño can make a dish taste spicy.',
  'mozzarella':'We sprinkled mozzarella over the pizza.',
  'haiku':'The student wrote a haiku about spring rain.',
  'origami':'We folded colorful paper into origami cranes.',
  'karate':'He practiced karate with his instructor.',
  'bamboo':'The panda ate bamboo in the forest.',
  'fossil':'The museum displayed a fossil of an ancient sea creature.',
  'umbrella':'She opened her umbrella when it began to rain.',
  'zenith':'At noon, the sun was near its zenith.',
  'graffiti':'Artists painted colorful graffiti on the approved mural wall.'
};
export function sentenceFor(w){
  if(typeof w.sentence==='string'&&w.sentence.trim())return w.sentence.trim();
  if(curated[w.word.toLowerCase()])return curated[w.word.toLowerCase()];
  const pos=w.part;
  if(pos==='v')return `In the story, the character decided to ${w.word}.`;
  if(pos==='adj')return `The writer described something as ${w.word}.`;
  if(pos==='adv')return `The musician tried to play ${w.word}.`;
  if(pos==='interj')return `The traveler said, “${w.word}!”`;
  return `In our lesson, we learned more about ${w.word}.`;
}
