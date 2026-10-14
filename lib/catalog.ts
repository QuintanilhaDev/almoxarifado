/**
 * Catálogo de materiais: código CC-GG-NNNN (categoria, grupo, sequência).
 * As categorias são fixas (Projeto 3, seção 2); os grupos ficam no banco e podem crescer.
 */
export const CATEGORIES: { cat: string; name: string }[] = [
  { cat: '01', name: 'Fardamento' },
  { cat: '02', name: 'EPI' },
  { cat: '03', name: 'Equipamentos operacionais' },
  { cat: '04', name: 'Armamento e munições' },
  { cat: '05', name: 'Eletrônicos e segurança' },
  { cat: '06', name: 'Informática e telefonia' },
  { cat: '07', name: 'Materiais de consumo' },
  { cat: '08', name: 'Ferramentas e manutenção' },
  { cat: '09', name: 'Móveis e utensílios' },
  { cat: '10', name: 'Outros materiais' },
];
export const categoryName = (cat: string | null | undefined) => CATEGORIES.find((c) => c.cat === cat)?.name ?? null;

export interface CatalogGroup {
  cat: string;
  grp: string;
  name: string;
}

/** Fardamento e EPI: têm histórico individual, termo e troca anual. */
export const PERSONAL_CATS = ['01', '02'];

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Palavras que indicam o grupo (a primeira regra que bater vale). */
const RULES: [string, string, RegExp][] = [
  ['02', '06', /\b(colete refletivo|refletiv\w*|cone|faixa de sinaliza\w*|sinaliza\w*)\b/],
  ['03', '02', /\b(colete balistico|balistic\w*|algema\w*|tonfa|cassetete|coldre|porta algema|porta tonfa|fiel|apito)\b/],
  ['01', '01', /\b(camisa\w*|camiseta\w*|blusa\w*|polo)\b/],
  ['01', '02', /\b(calca\w*|bermuda\w*|saia\w*|short\w*)\b/],
  ['01', '03', /\b(bota\w*|coturno\w*|sapato\w*|tenis|calcado\w*|botina\w*|chinelo\w*)\b/],
  ['01', '04', /\b(jaqueta\w*|agasalho\w*|casaco\w*|blusao|japona|capa de chuva|capa)\b/],
  ['01', '05', /\b(bone\w*|chapeu\w*|boina\w*|quepe\w*|touca\w*|gorro\w*)\b/],
  ['01', '06', /\b(cinto\w*|gravata\w*|meia\w*|cinta\w*|distintivo\w*|brasao|insignia\w*|platina\w*)\b/],
  ['02', '01', /\b(luva\w*)\b/],
  ['02', '02', /\b(capacete\w*)\b/],
  ['02', '03', /\b(oculos|viseira\w*)\b/],
  ['02', '04', /\b(protetor auricular|abafador\w*|auricular)\b/],
  ['02', '05', /\b(mascara\w*|respirador\w*|pff2?)\b/],
  ['03', '01', /\b(radio\w*|ht|antena\w*|transceptor\w*|bateria de radio|intercomunicador\w*)\b/],
  ['03', '03', /\b(lanterna\w*|pilha\w*|holofote\w*)\b/],
  ['04', '01', /\b(revolver\w*|pistola\w*|espingarda\w*|arma\w*|carabina\w*)\b/],
  ['04', '02', /\b(municao|municoes|cartucho\w*)\b/],
  ['05', '01', /\b(camera\w*|cftv|dvr|nvr)\b/],
  ['05', '02', /\b(alarme\w*|sensor\w*|sirene\w*)\b/],
  ['06', '01', /\b(computador\w*|notebook\w*|monitor\w*|teclado\w*|mouse|impressora\w*)\b/],
  ['06', '02', /\b(celular\w*|smartphone\w*|chip\w*|telefone\w*|carregador\w*)\b/],
  ['07', '01', /\b(detergente\w*|sabao|desinfetante\w*|vassoura\w*|rodo\w*|papel higienico|saco de lixo|alcool|limpeza)\b/],
  ['07', '02', /\b(caneta\w*|papel|grampeador\w*|pasta\w*|envelope\w*|livro de ocorrencia\w*|livro|prancheta\w*|caderno\w*)\b/],
  ['08', '01', /\b(alicate\w*|martelo\w*|furadeira\w*|chave de fenda|ferramenta\w*)\b/],
  ['08', '02', /\b(parafuso\w*|peca\w*|cadeado\w*|fechadura\w*)\b/],
  ['09', '01', /\b(cadeira\w*|mesa\w*|armario\w*|guarita\w*|banco)\b/],
  ['09', '02', /\b(garrafa\w*|copo\w*|cafeteira\w*|utensilio\w*|garrafa termica)\b/],
];

/** Sugere categoria e grupo pelo nome do item (o Almoxarifado confirma antes de gravar). */
export function suggestClass(name: string): { cat: string; grp: string; sure: boolean } {
  const n = ` ${fold(name)} `;
  for (const [cat, grp, re] of RULES) if (re.test(n)) return { cat, grp, sure: true };
  return { cat: '10', grp: '01', sure: false };
}

export const CODE_RE = /^\d{2}-\d{2}-\d{4}$/;
