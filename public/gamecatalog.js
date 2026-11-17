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
