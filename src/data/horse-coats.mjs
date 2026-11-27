export const COAT_DEFS = [
  ["Chestnut",         "#b85c28", "#7a3010", "#4a1a05"],
  ["Light Chestnut",   "#d4733a", "#c0622a", "#6b2a10"],
  ["Liver Chestnut",   "#7a3518", "#3d1a0a", "#1e0d05"],
  ["Flaxen Chestnut",  "#b85c28", "#e8d090", "#4a1a05"],
  ["Sorrel",           "#c45a20", "#8b3a10", "#3d1205"],
  ["Dark Sorrel",      "#9a3e18", "#5a2008", "#2a0e03"],
  ["Bay",              "#8b3a1a", "#1a0a04", "#0d0503"],
  ["Blood Bay",        "#7a2010", "#120804", "#080402"],
  ["Dark Bay",         "#5a2510", "#0e0604", "#060302"],
  ["Light Bay",        "#a84c28", "#2a1208", "#150904"],
  ["Mahogany Bay",     "#6b2a14", "#180804", "#0a0402"],
  ["Black",            "#1a1a1a", "#0e0e0e", "#060606"],
  ["Seal Brown",       "#2a1a10", "#150a06", "#080402"],
  ["Dark Brown",       "#3d2010", "#1e1008", "#0e0804"],
  ["Dapple Grey",      "#a0a0a0", "#787878", "#484848"],
  ["Light Grey",       "#c8c8c8", "#a0a0a0", "#606060"],
  ["Steel Grey",       "#787878", "#505050", "#303030"],
  ["Fleabitten Grey",  "#b8b0a8", "#909088", "#585450"],
  ["Rose Grey",        "#b0a8a0", "#888078", "#504840"],
  ["Palomino",         "#c8a040", "#e8d898", "#7a6020"],
  ["Dark Palomino",    "#a07828", "#c8b068", "#604818"],
  ["Cremello",         "#e8d8b0", "#f0e8c8", "#c0a870"],
  ["Perlino",          "#d8c8a0", "#e8dcc0", "#b09870"],
  ["Buckskin",         "#c8a050", "#1a0a04", "#0d0502"],
  ["Classic Dun",      "#b89058", "#2a1808", "#140c04"],
  ["Red Dun",          "#c07840", "#8a4820", "#4a2010"],
  ["Grullo",           "#808878", "#383c34", "#1c1e18"],
  ["Blue Roan",        "#606870", "#1a1e20", "#0c0e10"],
  ["Red Roan",         "#9a5848", "#3a1810", "#1e0c08"],
  ["Strawberry Roan",  "#b06858", "#7a3828", "#3e1c14"],
  ["Spotted",          "#c0c0b0", "#484840", "#282820"],
  ["Blanket",          "#d8d0c0", "#383028", "#181410"],
];
export function getCoatIndex(raceId, horseSlot) {
  const seed = (raceId||"").split("").reduce((a,c,i) => a + c.charCodeAt(0)*(i+horseSlot*7+11), 0);
  return Math.abs(seed) % COAT_DEFS.length;
}

export function getCoatName(index) {
  return COAT_DEFS[index % COAT_DEFS.length][0];
}
