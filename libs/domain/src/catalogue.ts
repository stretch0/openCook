/**
 * The starter catalogue every instance ships with: common groceries and
 * household things, grouped by aisle, with other names people use for them.
 *
 * It doesn't need to be complete. Anything not here becomes a household's own
 * item the first time someone types it, and households teach openCook their
 * own spellings by merging items. Add to it freely.
 *
 * Format: one string per aisle, items separated by "|", and other names for
 * an item after "=" (e.g. "spring onion=scallion=green onion").
 */
const AISLES: Record<string, string> = {
  produce:
    'apple|apricot|avocado|banana|blackberry|blueberry|cherry|clementine=satsuma=mandarin|cranberry|date|fig|grape|grapefruit|kiwi|lemon|lime|mango|melon|nectarine|orange|papaya|passion fruit|peach|pear|pineapple|plum|pomegranate|raspberry|rhubarb|strawberry|watermelon|' +
    'artichoke|asparagus|aubergine=eggplant|beetroot=beet|bok choy=pak choi|broccoli|tenderstem broccoli=broccolini|brussels sprout|butternut squash|cabbage|red cabbage|carrot|cauliflower|celeriac|celery|chilli=chili=chile|cucumber|courgette=zucchini|fennel|garlic|ginger|green bean|kale|leek|lettuce|iceberg lettuce|romaine lettuce=cos lettuce|mushroom|chestnut mushroom|okra|onion=brown onion=yellow onion|red onion|shallot|spring onion=scallion=green onion|parsnip|pea|pepper=bell pepper|potato|new potato|sweet potato|pumpkin|radish|rocket=arugula|spinach|baby spinach|swede=rutabaga|sweetcorn=corn|corn on the cob|tomato|cherry tomato|turnip|watercress|beansprout|mangetout=snow pea|sugar snap pea|' +
    'basil|bay leaf|chive|coriander=cilantro|dill|mint|oregano|parsley|flat-leaf parsley|rosemary|sage|tarragon|thyme|lemongrass',
  meat: 'bacon|beef mince=ground beef|beef steak=steak|stewing beef|chicken breast|chicken thigh|chicken drumstick|chicken wing|whole chicken|chorizo|duck breast|gammon|ham|lamb chop|lamb mince=ground lamb|leg of lamb|pancetta|pork chop|pork loin|pork mince=ground pork|pork belly|pork sausage=sausage|prosciutto=parma ham|salami|turkey breast|turkey mince=ground turkey|venison',
  fish: 'cod|haddock|salmon|smoked salmon|tuna steak|sea bass|mackerel|trout|prawn=shrimp|king prawn=jumbo shrimp|mussel|scallop|squid=calamari|crab|white fish',
  dairy:
    'butter|unsalted butter|salted butter|buttermilk|cheddar=cheddar cheese|cottage cheese|cream cheese|creme fraiche|double cream=heavy cream|single cream=light cream|sour cream|whipping cream|egg|feta|goats cheese|gruyere|halloumi|mascarpone|milk|whole milk|semi-skimmed milk|skimmed milk|mozzarella|parmesan=parmigiano reggiano|pecorino|ricotta|yogurt=yoghurt|greek yogurt=greek yoghurt|oat milk|almond milk|soy milk=soya milk|plant butter=vegan butter|tofu|tempeh',
  bakery:
    'bread|sourdough|wholemeal bread=whole wheat bread|baguette|bagel|brioche|burger bun|ciabatta|croissant|english muffin|flatbread|naan|pitta=pita|tortilla=wrap|crumpet|breadcrumb|panko',
  pantry:
    'plain flour=all-purpose flour=flour|self-raising flour=self-rising flour|strong white flour=bread flour|wholemeal flour=whole wheat flour|cornflour=cornstarch|baking powder|bicarbonate of soda=baking soda|yeast|caster sugar=superfine sugar|granulated sugar=sugar|icing sugar=powdered sugar|brown sugar|light brown sugar|dark brown sugar|demerara sugar|honey|maple syrup|golden syrup|treacle=molasses|vanilla extract|cocoa powder|dark chocolate|milk chocolate|white chocolate|chocolate chip|' +
    'basmati rice|long grain rice|risotto rice=arborio rice|jasmine rice|brown rice|rice|couscous|bulgur wheat|quinoa|pearl barley|polenta|pasta|spaghetti|penne|fusilli|linguine|tagliatelle|lasagne sheet=lasagna sheet|macaroni|orzo|egg noodle|rice noodle|udon noodle|oats=rolled oats=porridge oats|granola|cereal|' +
    'chickpea=garbanzo bean|kidney bean|black bean|cannellini bean|butter bean|borlotti bean|baked bean|red lentil|green lentil|puy lentil|chopped tomato=tinned tomato=canned tomato|passata|tomato puree=tomato paste|coconut milk|coconut cream|stock cube=bouillon cube|chicken stock=chicken broth|beef stock=beef broth|vegetable stock=vegetable broth|tuna=tinned tuna|anchovy|sweetcorn tin|' +
    'olive oil|extra virgin olive oil|vegetable oil|sunflower oil|rapeseed oil=canola oil|sesame oil|coconut oil|balsamic vinegar|red wine vinegar|white wine vinegar|cider vinegar=apple cider vinegar|rice vinegar|soy sauce|dark soy sauce|fish sauce|oyster sauce|hoisin sauce|worcestershire sauce|sriracha|hot sauce|ketchup|mayonnaise=mayo|mustard|dijon mustard|wholegrain mustard|english mustard|pesto|tahini|peanut butter|jam|marmalade|nutella|honey mustard|harissa|curry paste|miso|' +
    'almond|cashew|walnut|pecan|peanut|pine nut|pistachio|hazelnut|flaked almond|ground almond=almond flour|sesame seed|sunflower seed|pumpkin seed|chia seed|flaxseed=linseed|raisin|sultana|dried apricot|desiccated coconut|' +
    'salt|sea salt|black pepper=pepper corn|chilli flakes=red pepper flakes|cayenne pepper|paprika|smoked paprika|cumin|ground coriander|turmeric|garam masala|curry powder|cinnamon|nutmeg|ginger powder=ground ginger|allspice|cloves|cardamom|star anise|fennel seed|mustard seed|oregano dried=dried oregano|dried thyme|mixed herbs|italian seasoning|bay leaves dried|vanilla pod|' +
    'crisps=potato chips|crackers|biscuits=cookies|popcorn|rice cake|tea|coffee|instant coffee|hot chocolate',
  frozen:
    'frozen peas|frozen sweetcorn|frozen spinach|frozen berries|ice cream|frozen chips=fries|fish fingers=fish sticks|frozen prawns|puff pastry|shortcrust pastry|filo pastry=phyllo pastry|ice',
  drinks:
    'water|sparkling water|orange juice|apple juice|lemonade|cola|beer|red wine|white wine|cider|prosecco|gin|vodka|rum|whisky',
  household:
    'toilet paper=toilet roll=loo roll|kitchen roll=paper towel|tissues|washing up liquid=dish soap|dishwasher tablets|laundry detergent=washing powder|fabric softener|bin bags=trash bags|cling film=plastic wrap|foil=aluminium foil=tin foil|baking paper=parchment paper|sponges|bleach|surface cleaner|hand soap|batteries|light bulbs|freezer bags|sandwich bags',
  personal:
    'toothpaste|toothbrush|mouthwash|dental floss|shampoo|conditioner|shower gel=body wash|soap|deodorant|razors|shaving foam|sun cream=sunscreen|moisturiser=moisturizer|cotton buds=q-tips|plasters=band-aids|paracetamol|ibuprofen|nappies=diapers|baby wipes',
  pets: 'cat food|dog food|cat litter|dog treats',
};

export type CatalogueItem = {
  name: string;
  aliases: string[];
  category: string;
};

export const AISLE_NAMES: Record<string, string> = {
  produce: 'Fruit & veg',
  meat: 'Meat',
  fish: 'Fish',
  dairy: 'Dairy & eggs',
  bakery: 'Bakery',
  pantry: 'Cupboard',
  frozen: 'Frozen',
  drinks: 'Drinks',
  household: 'Household',
  personal: 'Toiletries & health',
  pets: 'Pets',
  other: 'Other',
};

export const CATALOGUE: CatalogueItem[] = Object.entries(AISLES).flatMap(
  ([category, list]) =>
    list.split('|').map((entry) => {
      const [name, ...aliases] = entry.split('=').map((s) => s.trim());
      return { name, aliases, category };
    }),
);
