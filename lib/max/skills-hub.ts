import { SECTORS, getSector, type SectorDef } from '../sectors';
import { maxEmit } from './bus';
import { bestMatches, listJoin, plural, type Query } from './text';
import type { MaxHost, MaxReply, Skill } from './types';

const USER_WORDS = ['usuario', 'usuarios', 'pessoa', 'pessoas', 'funcionario', 'funcionarios', 'colaborador', 'colaboradores', 'acesso', 'acessos', 'cadastro', 'cadastros', 'conta', 'contas', 'login', 'logins'];

function sectorIn(q: Query): SectorDef | null {
  return SECTORS.find((s) => s.aliases.some((a) => q.any(a)) || q.any(s.name)) ?? null;
}

function needUsers(host: MaxHost): MaxReply | null {
  if (!host.user?.is_master) return { say: 'Só um usuário master consulta o cadastro de usuários.' };
  if (!host.hub?.users()) return { say: 'Ainda estou carregando os usuários. Tente de novo em instantes.' };
  return null;
}

export const hubSkills: Skill[] = [
  {
    id: 'hub-create-user',
    scopes: ['hub'],
    examples: ['Max, criar usuário', 'Max, novo usuário no financeiro'],
    match: (q) => (q.re(/\b(cri\w+|nov[oa]|adicion\w+|cadastr\w+|inclu\w+|registr\w+)\b/) && q.any(...USER_WORDS, 'master') && !q.any('quantos', 'quantas', 'quem') ? 0.93 : 0),
    run: (q, host) => {
      if (!host.user?.is_master) return { say: 'Só um usuário master cria usuários.' };
      const sector = sectorIn(q);
      const m = q.raw.match(/(?:chamad[oa]|com (?:o )?nome(?: de)?|para (?:a |o )?)\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ' ]{1,38}?)(?=\s+(?:no|na|para|pro|pra|do|da|como|em)\b|[.,!?]|$)/i);
      const name = m ? m[1].trim().replace(/\b\p{L}/gu, (c) => c.toUpperCase()) : undefined;
      const master = Boolean(q.re(/\bmaster (geral|do hub|do sistema)\b/));
      return {
        say: `Abri o cadastro de usuário${name ? ` para ${name}` : ''}${sector ? `, já no setor ${sector.name}` : ''}. Defina o login e a senha e confirme.`,
        act: () => {
          host.goTab('usuarios');
          maxEmit('hub:users', { create: { name, sector: sector?.slug, master } });
        },
      };
    },
  },
  {
    id: 'hub-sector-master',
    scopes: ['hub'],
    examples: ['Max, quem é o master do almoxarifado?'],
    match: (q) => (q.any('master', 'responsavel', 'chefe', 'gestor', 'lider') && sectorIn(q) && q.any('quem', 'qual') ? 0.92 : 0),
    run: (q, host) => {
      const block = needUsers(host);
      if (block) return block;
      const s = sectorIn(q)!;
      const masters = host.hub!.users()!.filter((u) => u.sector === s.slug && u.sector_role === 'master' && u.active && !u.is_master);
      return {
        say: masters.length
          ? `${masters.length === 1 ? 'O master' : 'Os masters'} do setor ${s.name}: ${listJoin(masters.map((u) => u.display_name))}.`
          : `O setor ${s.name} ainda não tem um master definido.`,
        act: () => {
          host.goTab('usuarios');
          maxEmit('hub:users', { sector: s.slug });
        },
      };
    },
  },
  {
    id: 'hub-users-of-sector',
    scopes: ['hub'],
    examples: ['Max, quem está no almoxarifado?'],
    match: (q) => {
      const s = sectorIn(q);
      if (!s) return 0;
      if (q.re(/\b(quem|quais|quant[oa]s|list\w+|mostr\w+|equipe|time|pessoal)\b/) && (q.any(...USER_WORDS, 'equipe', 'time', 'quem', 'esta', 'estao', 'trabalha', 'trabalham', 'alocado', 'alocados'))) return 0.9;
      // "usuários do setor operacional", "tem alguém no financeiro?"
      if (q.any(...USER_WORDS, 'equipe', 'time', 'pessoal', 'alguem', 'ninguem', 'gente', 'integrantes', 'membros')) return 0.86;
      return 0;
    },
    run: (q, host) => {
      const block = needUsers(host);
      if (block) return block;
      const s = sectorIn(q)!;
      const list = host.hub!.users()!.filter((u) => u.sector === s.slug && !u.is_master);
      const act = () => {
        host.goTab('usuarios');
        maxEmit('hub:users', { sector: s.slug });
      };
      if (!list.length) return { say: `Ninguém está alocado no setor ${s.name} ainda.`, act };
      const names = list.slice(0, 5).map((u) => u.display_name);
      return {
        say: `O setor ${s.name} tem ${plural(list.length, 'pessoa', 'pessoas')}: ${listJoin(names)}${list.length > 5 ? ' e outras' : ''}.`,
        card: {
          kind: 'list',
          title: s.name,
          rows: list.slice(0, 8).map((u) => ({ label: u.display_name, value: u.sector_role === 'master' ? 'master do setor' : 'membro', sub: '@' + u.username + (u.active ? '' : ' · desativado') })),
          foot: list.length > 8 ? `e mais ${list.length - 8}` : undefined,
        },
        act,
      };
    },
  },
  {
    id: 'hub-find-user',
    scopes: ['hub'],
    examples: ['Max, em que setor está a Juliana?'],
    match: (q, host) => {
      const users = host.hub?.users();
      if (!users || !host.user?.is_master) return 0;
      if (!q.re(/\b(setor|onde|qual|permiss\w+|acesso|usuario|quem e|procur\w+|busc\w+|localiz\w+|encontr\w+|ach\w+)\b/)) return 0;
      const cleaned = q.norm.replace(/\b(em|que|qual|setor|esta|fica|trabalha|onde|o|a|do|da|de|usuario|usuaria|permissoes|permissao|acesso|quem|e|procurar|buscar|localizar|encontrar|achar|procure|busque|ache|encontre|pelo|pela|por)\b/g, ' ').trim();
      if (!cleaned) return 0;
      return bestMatches(cleaned, users, (u) => `${u.display_name} ${u.username}`, 0.8, 1).length ? 0.87 : 0;
    },
    run: (q, host) => {
      const users = host.hub!.users()!;
      const cleaned = q.norm.replace(/\b(em|que|qual|setor|esta|fica|trabalha|onde|o|a|do|da|de|usuario|usuaria|permissoes|permissao|acesso|quem|e|procurar|buscar|localizar|encontrar|achar|procure|busque|ache|encontre|pelo|pela|por)\b/g, ' ').trim();
      const u = bestMatches(cleaned, users, (x) => `${x.display_name} ${x.username}`, 0.8, 1)[0].item;
      const s = getSector(u.sector);
      const where = u.is_master ? 'é master geral do Max Hub' : s ? `está no setor ${s.name}, como ${u.sector_role === 'master' ? 'master do setor' : 'membro'}` : 'ainda não tem setor definido';
      return {
        say: `${u.display_name} ${where}${u.active ? '' : '. O acesso está desativado'}.`,
        text: `${u.display_name} (@${u.username}) ${where}${u.active ? '' : ' · acesso desativado'}.`,
        act: () => {
          host.goTab('usuarios');
          maxEmit('hub:users', { query: u.username });
        },
      };
    },
  },
  {
    id: 'hub-sector-not-ready',
    scopes: ['hub'],
    match: (q) => {
      const s = sectorIn(q);
      if (!s || s.ready) return 0;
      return q.any('metrica', 'metricas', 'relatorio', 'relatorios', 'indicador', 'indicadores', 'desempenho', 'resumo', 'numeros', 'dados', 'dashboard', 'grafico', 'resultado', 'resultados', 'balanco', 'movimentacao') ? 0.91 : 0;
    },
    run: (q, host) => {
      const s = sectorIn(q)!;
      const team = (host.hub?.users() ?? []).filter((u) => u.sector === s.slug && !u.is_master);
      return {
        say: `A ferramenta do setor ${s.name} ainda está em preparação, então não há métricas por enquanto. Hoje o setor tem ${plural(team.length, 'pessoa alocada', 'pessoas alocadas')}.`,
        chips: ['Max, métricas do almoxarifado', `Max, quem está no ${s.short}?`],
      };
    },
  },
  {
    id: 'hub-users-count',
    scopes: ['hub'],
    examples: ['Max, quantos usuários temos?'],
    match: (q) => {
      if (q.any(...USER_WORDS) && q.re(/\b(quant[oa]s|total|resumo|list\w+|mostr\w+|quais|todos)\b/)) return 0.88;
      if (q.any('metrica', 'metricas', 'resumo', 'panorama', 'visao geral', 'numeros', 'relatorio') && !sectorIn(q)) return 0.8;
      if (q.any('setor', 'setores') && q.re(/\b(quant[oa]s|quais|list\w+|resumo)\b/)) return 0.86;
      return 0;
    },
    run: (_q, host) => {
      const block = needUsers(host);
      if (block) return block;
      const users = host.hub!.users()!;
      const active = users.filter((u) => u.active);
      const masters = active.filter((u) => u.is_master).length;
      const unassigned = active.filter((u) => !u.is_master && !u.sector).length;
      const rows = SECTORS.map((s) => {
        const team = users.filter((u) => u.sector === s.slug && !u.is_master);
        const master = team.find((u) => u.sector_role === 'master');
        return { label: s.name, value: plural(team.length, 'pessoa', 'pessoas'), sub: master ? `master: ${master.display_name}` : 'sem master do setor' };
      });
      const biggest = SECTORS.map((s) => ({ s, n: users.filter((u) => u.sector === s.slug && !u.is_master).length })).sort((a, b) => b.n - a.n)[0];
      return {
        say: `O Max Hub tem ${plural(active.length, 'usuário ativo', 'usuários ativos')} em ${SECTORS.length} setores, sendo ${plural(masters, 'master geral', 'masters gerais')}.${biggest.n ? ` O maior setor é ${biggest.s.name}, com ${plural(biggest.n, 'pessoa', 'pessoas')}.` : ''}${unassigned ? ` ${plural(unassigned, 'pessoa está', 'pessoas estão')} sem setor.` : ''}`,
        card: { kind: 'list', title: 'Pessoas por setor', rows, foot: users.length !== active.length ? `${users.length - active.length} acesso(s) desativado(s)` : undefined },
      };
    },
  },
];

/** Setores cuja ferramenta ainda é só a tela padrão. */
export const emptySectorSkills: Skill[] = [
  {
    id: 'sector-not-ready',
    scopes: ['sector'],
    match: (q, host) => {
      if (!host.sector || host.sector.ready) return 0;
      return q.any('metrica', 'metricas', 'relatorio', 'relatorios', 'indicador', 'indicadores', 'desempenho', 'resumo', 'numeros', 'dados', 'dashboard', 'grafico', 'estatistica', 'estatisticas') ? 0.9 : 0;
    },
    run: (_q, host) => ({
      say: `A ferramenta do setor ${host.sector!.name} ainda está em preparação, então não há métricas por enquanto. Assim que as funções entrarem, eu passo a acompanhar tudo por aqui.`,
      chips: ['Max, que dia é hoje?', 'Max, abrir minha conta'],
    }),
  },
];
