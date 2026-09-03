/**
 * The demo film, scene by scene.
 *
 * Each scene is one piece of Hinglish narration plus BEATS — actions timed in
 * seconds from when that scene's voice starts. The recorder fires each beat at
 * its moment, so the screen does the thing while the voice is talking about it,
 * and then sits still until the sentence has finished. That waiting is the whole
 * point: a shopkeeper watching this has to be able to READ the screen, not catch
 * a glimpse of it.
 *
 * Narration is Latin-script Hinglish, which Sarvam's bulbul:v3 speaks correctly
 * (verified by transcribing its own output back).
 *
 * `js` bodies run inside the page with the __t helpers from record.cjs.
 */

/** A tiny helper so scenes read as data rather than string soup. */
const beat = (at, js) => ({ at, js })

module.exports = ({ ids }) => [

  /* ─────────────────────────── 1. Welcome ─────────────────────────── */
  {
    id: 'intro',
    text:
      'Namaste! Parivar Jewellery ERP mein aapka swagat hai. ' +
      'Yeh software khaas taur par sunar bhaiyon ke liye banaya gaya hai. ' +
      'Aaj main aapko poora software dikhaunga — bilkul aaram se, ek ek karke. ' +
      'Item banana, tag aur barcode lagana, grahak aur supplier ka hisaab, ' +
      'purchase, sales billing, receipt, order booking, aur refining. Sab kuch. ' +
      'Yeh jo aap screen par dekh rahe hain, yeh Dashboard hai. ' +
      'Dukaan kholte hi aapko sab kuch ek nazar mein dikh jaata hai — ' +
      'aaj ki sale kitni hui, stock mein kitna sona pada hai, ' +
      'aur kaunse grahak ka paisa abhi baaki hai. ' +
      'Roz subah bas yeh ek screen dekh lijiye, poori dukaan ka haal samajh aa jaayega.',
    beats: [
      beat(0, `__t.nav('Dashboard')`),
      beat(14, `__t.scrollTo(0.35)`),
      beat(22, `__t.scrollTo(0.75)`),
      beat(30, `__t.scrollTo(0)`),
    ],
  },

  /* ────────────────────── 2. Item Creation ────────────────────────── */
  {
    id: 'items',
    text:
      'Sabse pehle baat karte hain Item Creation ki. ' +
      'Dukaan mein jo bhi cheez aap bechte hain — ring, chain, bangle, payal — ' +
      'woh sab yahan ek baar bana dijiye. Ek baar ka kaam hai, baar baar nahin karna. ' +
      'Dekhiye, main ek naya item banata hoon. New Item par click kiya. ' +
      'Naam daala — Pendant. ' +
      'Phir batana hai ki yeh kaunsi dhaatu ka hai — Gold, aur kaunsi purity ka — bais carat. ' +
      'Aur bas, Save. ' +
      'Dekhiye software ne khud hi is item ka tag prefix bana diya — P E N. ' +
      'Matlab is item ke saare barcode P E N se shuru honge. ' +
      'Aapko kuch yaad rakhne ki zaroorat nahin, software khud sambhaal leta hai.',
    beats: [
      beat(0, `__t.nav('Item Creation')`),
      beat(9, `__t.scrollTo(0.4)`),
      beat(14, `__t.scrollTo(0); __t.click('New Item')`),
      beat(18, `__t.type('.modal input.input', 'Pendant')`),
      beat(24, `__t.pickSelect('.modal select.select', 0, '${ids.goldTypeId}')`),
      beat(28, `__t.pickSelect('.modal select.select', 1, '${ids.g22Id}')`),
      beat(33, `__t.clickIn('.modal-wrap', 'Save')`),
      beat(38, `__t.search('Pendant')`),
    ],
  },

  /* ──────────────────── 3. Tag & Barcode ──────────────────────────── */
  {
    id: 'barcode',
    text:
      'Ab aata hai sabse zaroori kaam — Tag aur Barcode. ' +
      'Jo bhi maal aapki dukaan mein aaya hai, uska ek ek piece yahan entry hoga. ' +
      'Item chuna — Pendant. Ab bas do cheezein daalni hain. ' +
      'Gross weight — aath point paanch gram. Aur purity — nabbe point chhe. ' +
      'Bas! Dekhiye, software ne turant khud se net weight aur fine weight nikaal diya. ' +
      'Saat point saat aath chhe gram fine. ' +
      'Aapko calculator uthane ki zaroorat hi nahin padi. ' +
      'Ab Save kar dete hain. Dekhiye, tag number khud ban gaya — P E N zero zero zero zero ek. ' +
      'Is number ka barcode aap yahin se print kar sakte hain, ' +
      'aur bill banate waqt bas scan kar dijiye — poora piece apne aap bill mein aa jaayega. ' +
      'Na weight likhna, na rate. Galti ka sawaal hi nahin.',
    beats: [
      beat(0, `__t.nav('Tag & Barcode')`),
      // The Pendant does not exist until the previous scene creates it, so its id
      // is a token the recorder fills in at the moment the beat fires.
      beat(12, `__t.pickSelect('select.select', 0, '%PENDANT%')`),
      beat(18, `__t.typeCell(0, 0, '8.500')`),
      beat(23, `__t.typeCell(0, 7, '91.6')`),
      beat(30, `__t.highlight('.grid-edit tbody tr:first-child input[readonly]')`),
      beat(42, `__t.click('Save 1 tag')`),
      beat(48, `__t.scrollTo(0.5)`),
      beat(56, `__t.scrollTo(0)`),
    ],
  },

  /* ────────────────────── 4. Customers ────────────────────────────── */
  {
    id: 'customers',
    text:
      'Ab baat karte hain grahak ki — Customers. ' +
      'Har grahak ka poora record yahan rehta hai. Naam, mobile number, address, ' +
      'aur sabse zaroori — uska hisaab. ' +
      'Naya grahak jodna bahut aasan hai. New Customer, naam daaliye, mobile daaliye, Save. ' +
      'Ho gaya. ' +
      'Ab jab bhi yeh grahak dukaan aayega, aap naam type karte hi uska poora hisaab dekh sakte hain — ' +
      'kitna udhaar hai, kitna sona jama hai, pehle kya kharida tha. ' +
      'Woh purani bahi khaata wali diary ab bhoolna padegi. ' +
      'Sab kuch yahan surakshit hai, aur ek second mein mil jaata hai.',
    beats: [
      beat(0, `__t.nav('Customers')`),
      beat(10, `__t.scrollTo(0.4)`),
      beat(15, `__t.scrollTo(0); __t.click('New Customer')`),
      beat(20, `__t.typeInputs('.modal', [['Sunita Deshmukh'], ['9822011223']])`),
      beat(28, `__t.clickIn('.modal-wrap', 'Save')`),
      beat(34, `__t.search('Sunita')`),
      beat(36, `__t.search('')`),
    ],
  },

  /* ────────────────────── 5. Suppliers ────────────────────────────── */
  {
    id: 'suppliers',
    text:
      'Isi tarah Suppliers ki list bhi alag rehti hai. ' +
      'Jinse aap maal kharidte hain — wholesaler, bullion dealer, karagir — sab yahan. ' +
      'Har supplier ka do tarah ka hisaab software rakhta hai. ' +
      'Ek paise ka hisaab, aur doosra sone ka hisaab — fine weight mein. ' +
      'Yeh baat bahut important hai. ' +
      'Kyunki hamare dhande mein aksar paisa nahin, sona chalta hai. ' +
      'Kitna sona kisko diya, kitna wapas aaya — software poora hisaab rakhta hai, ' +
      'gram ke teesre decimal tak.',
    beats: [
      beat(0, `__t.nav('Suppliers')`),
      beat(9, `__t.scrollTo(0.35)`),
      beat(17, `__t.scrollTo(0.7)`),
      beat(26, `__t.scrollTo(0)`),
    ],
  },

  /* ────────────────────── 6. Purchase ─────────────────────────────── */
  {
    id: 'purchase',
    text:
      'Ab dekhte hain Purchase — yaani maal kharidna. ' +
      'Supplier ka naam chuna. Ab maal ki entry. ' +
      'Item ka naam, weight, purity, aur rate. ' +
      'Dekhiye, jaise hi maine weight aur rate daala, ' +
      'software ne khud amount nikaal diya, GST joda, aur bill ka total bana diya. ' +
      'Aur sabse achhi baat — ' +
      'jaise hi yeh purchase save hogi, do kaam apne aap ho jaayenge. ' +
      'Ek, yeh maal aapke stock mein jud jaayega. ' +
      'Aur do, supplier ke khaate mein aapka udhaar chadh jaayega. ' +
      'Aapko alag se kahin kuch likhne ki zaroorat nahin. ' +
      'Ek entry, aur poori dukaan ka hisaab apne aap update.',
    beats: [
      beat(0, `__t.nav('Purchase')`),
      beat(6, `__t.click('New Purchase')`),
      beat(10, `__t.pickAuto('supplier', 'Bullion')`),
      beat(16, `__t.typePurchaseLine('Chain', '50', '91.6', '62000')`),
      beat(30, `__t.highlight('.total-row')`),
      beat(36, `__t.scrollTo(0.6)`),
      beat(42, `__t.scrollTo(0)`),
    ],
  },

  /* ──────────────────── 7. Sales Invoice ──────────────────────────── */
  {
    id: 'sales',
    text:
      'Ab aata hai dil ka kaam — Sales Invoice. Bill banana. ' +
      'Grahak ka naam type kiya, aur uska poora record saamne. ' +
      'Ab maal daalna hai. Yahan aap barcode scan kar sakte hain, ' +
      'ya phir naam type karke chun sakte hain. ' +
      'Dekhiye — maine tag chuna, aur poora piece bill mein aa gaya. ' +
      'Weight, purity, making charge, hallmark — sab apne aap. ' +
      'Aaj ka sone ka rate daaliye, aur bas. ' +
      'Neeche dekhiye — goods ka amount, making charge, GST teen percent, ' +
      'aur grand total. Sab live, aapke saamne banta hua. ' +
      'Ab ek aur cheez dikhata hoon jo har sunar ko chahiye — purana sona. ' +
      'Grahak apna purana zewar de raha hai. Uska weight aur purity daaliye, ' +
      'software uski keemat nikaal kar bill mein se kaat dega. ' +
      'Yeh dekhiye — ab grahak ko sirf bacha hua paisa dena hai. ' +
      'Cash liya, ya card, ya UPI — sab yahin. ' +
      'Save kijiye, aur bill print ke liye tayyar hai.',
    beats: [
      beat(0, `__t.nav('Sales Invoice')`),
      beat(6, `__t.pickAuto('customer', 'Sandip')`),
      beat(16, `__t.pickTag(0)`),
      beat(27, `__t.typeRate('62000')`),
      beat(33, `__t.highlight('.total-row')`),
      beat(44, `__t.openUrd()`),
      beat(47, `__t.typeUrd('12', '88')`),
      beat(58, `__t.highlight('.total-row')`),
      beat(62, `__t.scrollTo(0.7)`),
    ],
  },

  /* ────────────────────── 8. Receipts ─────────────────────────────── */
  {
    id: 'receipts',
    text:
      'Maan lijiye grahak ne aaj poora paisa nahin diya. Kuch udhaar reh gaya. ' +
      'Jab woh baad mein paisa dene aaye, to aap Receipts mein aayenge. ' +
      'Grahak ka naam chuna — dekhiye, software turant bata raha hai ki ' +
      'is grahak par kitna baaki hai. ' +
      'Amount daaliye, cash ya bank chuniye, aur Save. ' +
      'Bas. Uska hisaab kam ho gaya, aur cash book mein paisa chadh gaya. ' +
      'Do jagah likhne ki zaroorat nahin — ek entry, dono kaam.',
    beats: [
      beat(0, `__t.nav('Receipts')`),
      beat(8, `__t.click('New Receipt')`),
      beat(12, `__t.pickAuto('party', 'Sandip')`),
      beat(22, `__t.highlight('.modal .hint, .modal .note, .modal .muted')`),
      beat(28, `__t.scrollTo(0.4)`),
      beat(34, `__t.scrollTo(0)`),
    ],
  },

  /* ────────────────────── 9. Orders ───────────────────────────────── */
  {
    id: 'orders',
    text:
      'Ab Order Booking. ' +
      'Grahak ne kuch banwane ka order diya — maan lijiye ek kada. ' +
      'Yahan aap order likh dijiye — kya banana hai, kitne weight ka, ' +
      'kab tak dena hai, aur kitna advance liya. ' +
      'Ek aur khaas baat — karagir ki date alag se. ' +
      'Matlab grahak ko aapne pandrah tarikh ka bola hai, ' +
      'to karagir se aap barah tarikh ka maangiye. ' +
      'Software aapko dono ki yaad dilata rahega. ' +
      'Jab maal ban kar aa jaaye, ek button dabaiye — ' +
      'yeh order seedha bill ban jaayega, ' +
      'aur jo advance aapne pehle liya tha, woh apne aap bill mein adjust ho jaayega. ' +
      'Dobara type karne ki zaroorat nahin.',
    beats: [
      beat(0, `__t.nav('Orders')`),
      beat(8, `__t.scrollTo(0.35)`),
      beat(16, `__t.scrollTo(0)`),
      beat(24, `__t.click('New Order')`),
      beat(34, `__t.scrollTo(0.45)`),
      beat(40, `__t.scrollTo(0.85)`),
      beat(45, `__t.scrollTo(0)`),
    ],
  },

  /* ───────────────────── 10. Refining ─────────────────────────────── */
  {
    id: 'refining',
    text:
      'Ab baat karte hain Refining ki — yaani sona galana. ' +
      'Purana sona, kaat, polish ka scrap — yeh sab jama hota rehta hai. ' +
      'Jab aap ise refinery bhejte hain, yahan entry kar dijiye. ' +
      'Kitna weight bheja, kaunsi purity ka. ' +
      'Aur jab refinery se shuddh sona wapas aata hai, ' +
      'woh bhi yahan darj kar dijiye. ' +
      'Software turant bata dega ki kitna sona kam hua — yaani kitna loss gaya. ' +
      'Yeh hisaab bahut zaroori hai. ' +
      'Kai baar refinery se thoda kam sona wapas aata hai, ' +
      'aur agar hisaab na ho to pata hi nahin chalta. ' +
      'Yahan har gram ka hisaab saamne rehta hai.',
    beats: [
      beat(0, `__t.nav('Refining')`),
      beat(10, `__t.scrollTo(0.3)`),
      beat(22, `__t.scrollTo(0.6)`),
      beat(34, `__t.scrollTo(0.9)`),
      beat(44, `__t.scrollTo(0)`),
    ],
  },

  /* ───────────────────── 11. Karagir ──────────────────────────────── */
  {
    id: 'karagir',
    text:
      'Isi tarah karagir ka hisaab bhi. ' +
      'Aapne karagir ko do sau gram sona diya chain banane ke liye. ' +
      'Yahan entry kar dijiye. ' +
      'Jab woh chain bana kar laaya, uska weight daal dijiye. ' +
      'Software batayega ki wastage kitni gayi, ' +
      'aur agar karagir par koi sona baaki hai to woh bhi saamne dikhega. ' +
      'Har karagir ka alag khaata, gram ke hisaab se.',
    beats: [
      beat(0, `__t.nav('Ledger / Khata')`),
      beat(4, `__t.pickAuto('customer', 'Chetan')`),
      beat(13, `__t.click('Metal')`),
      beat(20, `__t.scrollTo(0.35)`),
    ],
  },

  /* ───────────────────── 12. Reports ──────────────────────────────── */
  {
    id: 'reports',
    text:
      'Ab sabse zaroori hissa — Reports. ' +
      'Yeh Stock Report hai. Aapki dukaan mein is waqt kya kya pada hai, ' +
      'kitne piece, kitna weight, aur uski keemat kitni hai. ' +
      'Yeh raha Day Book. ' +
      'Din bhar mein kya kya hua — kitni sale hui, kitna cash aaya, ' +
      'stock kitna tha aur kitna bacha. ' +
      'Raat ko dukaan band karte waqt bas yeh ek page dekh lijiye. ' +
      'Yeh Ledger hai — kisi bhi grahak ya supplier ka poora khaata, ' +
      'shuru se aaj tak. ' +
      'Aur yeh GST Reports. ' +
      'GSTR one ki poori report yahan tayyar milti hai. ' +
      'CA ko bas yeh file bhej dijiye. ' +
      'Har report ko aap print kar sakte hain, ya Excel mein nikaal sakte hain.',
    beats: [
      beat(0, `__t.nav('Stock Report')`),
      beat(8, `__t.scrollTo(0.45)`),
      beat(15, `__t.nav('Day Book')`),
      beat(24, `__t.scrollTo(0.5)`),
      beat(31, `__t.nav('Ledger / Khata')`),
      beat(33, `__t.pickAuto('customer', 'Sandip')`),
      beat(43, `__t.nav('GST Reports')`),
      beat(49, `__t.scrollTo(0.45)`),
    ],
  },

  /* ───────────────────── 13. Closing ──────────────────────────────── */
  {
    id: 'closing',
    text:
      'To yeh tha Parivar Jewellery ERP. ' +
      'Item se lekar barcode tak, purchase se lekar bill tak, ' +
      'grahak ke udhaar se lekar karagir ke sone tak — poori dukaan, ek software mein. ' +
      'Yeh internet ke bina bhi chalta hai, aapke apne computer par. ' +
      'Aapka data aapke paas rehta hai, kisi aur ke server par nahin. ' +
      'Aur roz apne aap backup bhi ho jaata hai. ' +
      'Sabse badi baat — yeh software sunar ki bhaasha samajhta hai. ' +
      'Fine weight, touch, wastage, karagir, URD — ' +
      'yeh sab hamare dhande ke shabd hain, aur software inhe theek se sambhaalta hai. ' +
      'Ek baar khud chala kar dekhiye. ' +
      'Demo ke liye humein call kijiye. Dhanyavaad!',
    beats: [
      beat(0, `__t.nav('Dashboard')`),
      beat(16, `__t.scrollTo(0.4)`),
      beat(28, `__t.scrollTo(0)`),
      beat(38, `__t.scrollTo(0.3)`),
      beat(44, `__t.scrollTo(0)`),
    ],
  },
]
