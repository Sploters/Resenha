// Catálogo de jogos conhecidos fora da Steam (ou que a detecção do PC nomeia errado): nome certo, ícone e banner
// oficiais e links (site oficial, loja). Usado pelo servidor (corrige o nome do "Jogando X" que o app desktop manda)
// e pela página (ícone, banner e botões do popup do jogo). Sem DOM: o servidor importa este arquivo também.
//
// As imagens são endereços públicos dos sites oficiais; se um deles sair do ar, o cartão volta para o ícone de controle.
const RIOT = 'https://cmsassets.rgpub.io/sanity/images/dsfx7636';

export const KNOWN_GAMES = [
  { key: 'valorant', title: 'VALORANT', ids: ['valorant-win64-shipping', 'valorant'], titles: ['valorant'],
    icon: `${RIOT}/news/cbf4460132cdfeb2a97fad5f9dd25ba0bc058f76-128x128.png`,
    banner: `${RIOT}/news_live/296cff0d10e916f8a529ec9b60da134f0c80a448-1920x1080.png?w=960&fm=jpg&q=80`,
    links: [{ name: 'Site oficial', url: 'https://playvalorant.com/pt-br/' }, { name: 'Epic Games', url: 'https://store.epicgames.com/p/valorant?lang=pt-BR' }] },
  { key: 'lol', title: 'League of Legends', ids: ['league of legends', 'leagueclient', 'leagueclientux'], titles: ['leagueoflegends', 'lol'],
    icon: `${RIOT}/news_live/d3b7bd9decb1e1672dcb80be4f8bc1aa05490dc1-110x70.svg`,
    banner: `${RIOT}/news_live/12474c4bfa178d523d3935227373133a32ae0445-1920x1080.jpg?w=960&q=80`,
    links: [{ name: 'Site oficial', url: 'https://www.leagueoflegends.com/pt-br/' }, { name: 'Epic Games', url: 'https://store.epicgames.com/p/league-of-legends?lang=pt-BR' }] },
  // Minecraft Java roda no javaw.exe: o ícone do executável é o do Java (o Duke com o cadeado), nunca o do jogo
  { key: 'minecraft', title: 'Minecraft', ids: ['minecraft', 'minecraft.windows', 'javaw'], titles: ['minecraft'],
    icon: 'https://www.minecraft.net/content/dam/minecraftnet/franchise/logos/minecraft-creeper-face.jpg',
    banner: 'https://www.minecraft.net/content/dam/minecraftnet/games/minecraft/key-art/Global-Header_Image-Tile_MC-Java-Bedrock_570x321.jpg',
    links: [{ name: 'Site oficial', url: 'https://www.minecraft.net/pt-br' }] },
  { key: 'gla', title: 'Grand Line Adventures', ids: ['grandlineadventures', 'grand line adventures', 'gla'], titles: ['grandlineadventures', 'gla'],
    links: [{ name: 'Site oficial', url: 'https://grandlineadventures.com/en/' }] },
  { key: 'helldivers2', title: 'HELLDIVERS 2', steam: '553850', ids: ['helldivers2'], titles: ['helldivers2'] },
  { key: 'deadasdisco', title: 'Dead as Disco', steam: '3404260', ids: ['pagoda', 'pagoda-win64-shipping', 'deadasdisco', 'deadasdisco-win64-shipping'], titles: ['deadasdisco', 'pagoda'] },

  // EA app: o executável tem nome interno (TS4_x64); a arte vem da loja da Steam, onde os mesmos jogos estão
  { key: 'sims4', title: 'The Sims 4', steam: '1222670', ids: ['ts4_x64', 'ts4_dx9_x64', 'ts4'], titles: ['thesims4', 'sims4'],
    links: [{ name: 'EA app', url: 'https://www.ea.com/pt-br/games/the-sims/the-sims-4' }] },
  { key: 'apex', title: 'Apex Legends', steam: '1172470', ids: ['r5apex', 'r5apex_dx12'], titles: ['apexlegends'] },
  { key: 'bf6', title: 'Battlefield 6', steam: '2807960', ids: ['bf6', 'bf6event'], titles: ['battlefield6'] },
  { key: 'bf2042', title: 'Battlefield 2042', steam: '1517290', ids: ['bf2042'], titles: ['battlefield2042'] },
  { key: 'fc26', title: 'EA SPORTS FC 26', steam: '3405690', ids: ['fc26'], titles: ['easportsfc26', 'fc26'] },
  { key: 'ittakestwo', title: 'It Takes Two', steam: '1426210', ids: ['ittakestwo'], titles: ['ittakestwo'] },
  { key: 'splitfiction', title: 'Split Fiction', steam: '2001120', ids: ['splitfiction'], titles: ['splitfiction'] },
  { key: 'nfsunbound', title: 'Need for Speed Unbound', steam: '1846380', ids: ['needforspeedunbound'], titles: ['needforspeedunbound'] },

  // Battle.net: os que também estão na Steam usam a arte de lá; os só da Battle.net, a imagem do site oficial
  { key: 'overwatch', title: 'Overwatch 2', steam: '2357570', ids: ['overwatch'], titles: ['overwatch', 'overwatch2'],
    links: [{ name: 'Site oficial', url: 'https://overwatch.blizzard.com/pt-br/' }] },
  { key: 'diablo4', title: 'Diablo IV', steam: '2344520', ids: ['diablo iv', 'diabloiv'], titles: ['diabloiv', 'diablo4'],
    links: [{ name: 'Site oficial', url: 'https://diablo4.blizzard.com/pt-br/' }] },
  { key: 'cod', title: 'Call of Duty', steam: '1938090', ids: ['cod', 'cod24-cod', 'cod25-cod', 'blackops6', 'blackops7'], titles: ['callofduty', 'callofdutyblackops6', 'callofdutyblackops7', 'callofdutywarzone'] },
  { key: 'wow', title: 'World of Warcraft', ids: ['wow', 'wowclassic', 'wow-64'], titles: ['worldofwarcraft'],
    icon: 'https://blz-contentstack-images.akamaized.net/v3/assets/blt9c12f249ac15c7ec/bltb5a24e5ab1e2cfb0/6a88e3589b942efdb6f74110/wow-thumbnail-homepage.jpg',
    banner: 'https://blz-contentstack-images.akamaized.net/v3/assets/blt9c12f249ac15c7ec/bltb5a24e5ab1e2cfb0/6a88e3589b942efdb6f74110/wow-thumbnail-homepage.jpg',
    links: [{ name: 'Site oficial', url: 'https://worldofwarcraft.blizzard.com/pt-br/' }] },
  { key: 'hearthstone', title: 'Hearthstone', ids: ['hearthstone'], titles: ['hearthstone'],
    banner: 'https://d39zum0jwvcigt.cloudfront.net/_next/static/images/default-475d770302527dbab7708dca2af05afd.jpg',
    links: [{ name: 'Site oficial', url: 'https://hearthstone.blizzard.com/pt-br' }] },
  { key: 'sc2', title: 'StarCraft II', ids: ['sc2_x64', 'sc2'], titles: ['starcraftii', 'starcraft2'],
    banner: 'https://blz-contentstack-images.akamaized.net/v3/assets/blt9c12f249ac15c7ec/bltbe2068a317e02d9f/6966bac0fb2fd910dbda4a26/og_image.webp',
    links: [{ name: 'Site oficial', url: 'https://starcraft2.blizzard.com/pt-br/' }] },
  { key: 'diablo3', title: 'Diablo III', ids: ['diablo iii64', 'diablo iii'], titles: ['diabloiii', 'diablo3'],
    banner: 'https://blz-contentstack-images.akamaized.net/v3/assets/blt9c12f249ac15c7ec/blte3178c04d93773f1/67ce27f440e6651e27e17582/og_image.webp',
    links: [{ name: 'Site oficial', url: 'https://diablo3.blizzard.com/pt-br/' }] },
];

// executáveis que não são o jogo: anticheat que abre o jogo (Easy Anti-Cheat, BattlEye) e o Java. O ícone deles
// é o do anticheat/Java e o nome da janela pode ser um aviso ("GPU drivers are out of date"), então não servem.
export const WRAPPER_EXE = /^(start_protected_game|easyanticheat(_eos)?(_setup)?|eac_?launcher|eaclauncher|battleye(launcher)?|beservice(_x64)?|.+_be|.+_eac|javaw?)$/i;

const norm = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[™®©]/g, '').replace(/[^a-z0-9]+/g, '');
// game = { id, title, steam?, known? } -> entrada do catálogo ou null
export function knownGame(game) {
  if (!game) return null;
  if (game.known) { const k = KNOWN_GAMES.find(x => x.key === game.known); if (k) return k; }
  const id = String(game.id || '').toLowerCase(), t = norm(game.title), st = game.steam ? String(game.steam) : null;
  return KNOWN_GAMES.find(x => (st && x.steam === st) || x.ids.includes(id) || (t && x.titles.includes(t))) || null;
}
