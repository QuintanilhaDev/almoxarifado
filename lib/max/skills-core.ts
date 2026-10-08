import { SECTORS, getSector, sectorPath } from '../sectors';
import { tryCalc } from './calc';
import { PERIOD_GREETING, dateText, dayPeriod, firstName, timeText, type DayPeriod } from './clock';
import { listJoin, pick } from './text';
import type { MaxHost, Skill } from './types';

const VERB_GO = ['abrir', 'abre', 'abra', 'ir', 'vai', 'va', 'vamos', 'mostrar', 'mostra', 'mostre', 'ver', 'veja', 'exibir', 'exiba', 'acessar', 'acesse', 'entrar', 'leva', 'leve', 'navegar', 'navegue', 'quero', 'desejo', 'preciso', 'abrindo', 'visualizar', 'voltar', 'volta', 'volte'];

function name(host: MaxHost): string {
  const n = firstName(host.user?.display_name);
  return n ? `, ${n}` : '';
}

function saidPeriod(q: { any: (...t: string[]) => boolean }): DayPeriod | null {
  if (q.any('bom dia')) return 'manha';
  if (q.any('boa tarde')) return 'tarde';
  if (q.any('boa noite')) return 'noite';
  return null;
}

export function capabilities(host: MaxHost): string[] {
  if (host.scope === 'login') return ['Max, apresente-se', 'Max, que horas são?', 'Max, como faço para entrar?', 'Max, quero fazer uma solicitação'];
  if (host.scope === 'hub') return ['Max, quantos usuários temos?', 'Max, quem está no almoxarifado?', 'Max, criar usuário', 'Max, abrir o setor financeiro'];
  if (host.sector?.slug === 'almoxarifado') {
    return ['Max, métricas da última semana', 'Max, tem solicitação nova?', 'Max, o que está com estoque baixo?', 'Max, quanto tem de bota 42?'];
  }
  return ['Max, que dia é hoje?', 'Max, quanto é 15% de 2400?', 'Max, abrir minha conta', 'Max, como está o tempo?'];
}

export const coreSkills: Skill[] = [
  /* ---------- parar / repetir / voz ---------- */
  {
    id: 'stop',
    match: (q) =>
      q.re(/^(para|pare|parar|chega|silencio|quieta|cala a boca|cale se|cancela|cancelar|cancele|deixa|deixa pra la|esquece|esqueca|nada|nada nao|fechar|fecha|feche|pode fechar|sai|obrigado so isso)$/)
        ? 0.97
        : q.re(/^(pode parar|para de falar|pare de falar|fica quieta|deixa quieto|nao precisa)\b/)
          ? 0.95
          : 0,
    run: () => ({ say: '', text: 'Tudo bem.', source: 'stop' }),
  },
  {
    id: 'repeat',
    examples: ['Max, repete'],
    match: (q) => (q.re(/^(repete|repita|repetir|de novo|outra vez|fala de novo|pode repetir|como|o que|nao entendi|nao ouvi)( por favor)?$/) ? 0.93 : 0),
    run: (_q, _h, mem) =>
      mem.last && mem.last.say ? { ...mem.last, act: undefined, afterSpeech: undefined } : { say: 'Ainda não falei nada para repetir.' },
  },
  {
    id: 'voice-off',
    examples: ['Max, modo silencioso'],
    match: (q) => (q.re(/\b(modo silencioso|fique muda|fica muda|sem voz|desativ\w+ (a |sua )?voz|deslig\w+ (a |sua )?voz|nao fale|so texto|responda por escrito)\b/) ? 0.94 : 0),
    run: (_q, _h, mem) => {
      mem.setVoice(false);
      return { say: '', text: 'Modo silencioso ligado: respondo só por escrito. Para voltar, diga “Max, pode falar”.' };
    },
  },
  {
    id: 'voice-on',
    match: (q) => (q.re(/\b(pode falar|volt\w+ a falar|ativ\w+ (a |sua )?voz|lig\w+ (a |sua )?voz|com voz|fale comigo)\b/) ? 0.94 : 0),
    run: (_q, _h, mem) => {
      mem.setVoice(true);
      return { say: 'Voz ligada. Pode falar comigo.' };
    },
  },

  /* ---------- saudação e apresentação ---------- */
  {
    id: 'greet',
    examples: ['Max, bom dia'],
    match: (q) => {
      const short = q.tokens.length <= 6;
      if (q.any('bom dia', 'boa tarde', 'boa noite')) return short ? 0.95 : 0.55;
      if (q.re(/^(oi|ola|opa|e ai|eai|salve|hey|hello|alo|fala|fala ai|oi oi|oie|bao|beleza)( max)?( tudo bem| tudo bom| beleza| como vai)?$/)) return 0.93;
      return 0;
    },
    run: (q, host) => {
      const now = dayPeriod();
      const said = saidPeriod(q);
      const correct = PERIOD_GREETING[now];
      const { written } = timeText();
      const tail =
        host.scope === 'login'
          ? ' Entre com seu usuário e senha e eu te levo ao seu setor.'
          : pick([' No que posso ajudar?', ' Como posso ajudar?', ' Estou por aqui.']);
      if (said && said !== now) {
        const fix = now === 'manha' ? 'ainda é de manhã' : now === 'tarde' ? 'já é de tarde' : 'já é de noite';
        return {
          say: `${correct}${name(host)}! Aqui em Salvador ${fix}.${tail}`,
          text: `${correct}${name(host)}! Aqui em Salvador ${fix} (${written}).${tail}`,
        };
      }
      return { say: `${correct}${name(host)}!${tail}` };
    },
  },
  {
    id: 'introduce',
    examples: ['Max, apresente-se'],
    match: (q) => {
      // "apresente-se" / "se apresenta" — mas NÃO "me apresente as métricas" (aí é pedido de dados)
      if (q.re(/\b(apresent\w+[- ]se|se apresent\w+|apresent\w+ (voce|a max|a si mesma))\b/)) return 0.96;
      if (q.tokens.length <= 2 && q.re(/^(se )?apresent\w+$/)) return 0.9;
      if (q.re(/\b(quem e voce|quem e vc|quem voce e|qual (e )?(o )?seu nome|como voce se chama|como e seu nome|o que e voce|voce e o que|voce e quem|fale sobre voce|fala sobre voce|me fale de voce)\b/)) return 0.95;
      if (q.re(/\b(o que e|que e|para que serve|pra que serve|como funciona) (o |a |esse |este |essa |esta )?(max hub|maxhub|hub|sistema|plataforma|site)\b/)) return 0.93;
      return 0;
    },
    run: (q, host) => {
      const sectors = listJoin(SECTORS.map((s) => s.name));
      // cumprimenta conforme o horário de Salvador; se pedirem "a todos", fala com a sala
      const period = PERIOD_GREETING[dayPeriod()];
      const crowd = Boolean(q.re(/\b(todos|todas|todo mundo|pessoal|galera|turma|sala|equipe|time|plateia|publico|convidados|visitantes|presentes|gente|clientes|diretoria|reuniao)\b/));
      const hello = crowd ? `Olá a todos, ${period.toLowerCase()}!` : `${period}${name(host)}!`;
      if (host.scope === 'login') {
        return {
          say: `${hello} Eu sou a Max, a assistente virtual do Max Hub. Aqui os setores da empresa trabalham em um só lugar: ${sectors}. Entre com seu usuário e senha, e eu levo você direto para a ferramenta do seu setor. Lá dentro, é só me chamar.`,
          text: `${hello} Eu sou a Max, a assistente virtual do Max Hub. Entre com seu usuário e senha e eu levo você direto para a ferramenta do seu setor.`,
          chips: ['Max, que horas são?', 'Max, como faço para entrar?'],
        };
      }
      const where = host.scope === 'hub' ? 'no painel master, de onde você administra todos os setores e usuários' : `na ferramenta do setor ${host.sector?.name}`;
      return {
        say: `${hello} Eu sou a Max, a assistente virtual do Max Hub. Você está ${where}. Posso abrir telas, buscar informações, fazer contas e responder perguntas. Clique em mim e diga “Max”, seguido do que precisa.`,
        chips: capabilities(host),
      };
    },
  },
  {
    id: 'help',
    examples: ['Max, o que você sabe fazer?'],
    match: (q) =>
      q.re(/\b(ajuda|help|socorro|comandos|o que (voce|vc) (sabe|pode|consegue|faz)|que (voce|vc) (sabe|pode|consegue) fazer|como (te |eu te )?us\w+|como funciona voce|quais comandos|me ajud\w+|pode me ajudar|suas funcoes|o que da pra fazer)\b/)
        ? 0.9
        : 0,
    run: (_q, host) => {
      if (host.scope === 'login') {
        return {
          say: 'Nesta tela eu me apresento, digo as horas e explico como entrar. Depois do login, fico no canto da tela do seu setor: clique em mim, espere eu ficar verde e diga “Max”, seguido do pedido.',
          chips: capabilities(host),
        };
      }
      const extra =
        host.scope === 'hub'
          ? 'contar e localizar usuários, abrir a criação de usuário e levar você a qualquer setor'
          : host.sector?.slug === 'almoxarifado'
            ? 'mostrar métricas, contar solicitações, consultar o saldo de um item, avisar o que está com estoque baixo e dizer o que há em cada posto'
            : 'abrir as telas do setor';
      return {
        say: `Posso ${extra}. Também digo a hora e a data, faço contas, vejo o tempo e respondo perguntas gerais. Alguns exemplos estão na tela.`,
        chips: capabilities(host),
      };
    },
  },

  /* ---------- hora, data ---------- */
  {
    id: 'time',
    examples: ['Max, que horas são?'],
    match: (q) => (q.re(/\b(que horas|quantas horas|qual (e )?a hora|me diz a hora|me diga a hora|horas sao|hora certa|horario agora|que hora e)\b/) ? 0.94 : 0),
    run: () => {
      const t = timeText();
      return { say: `Agora são ${t.spoken}, no horário de Salvador.`, text: `Agora são ${t.written}, no horário de Salvador.` };
    },
  },
  {
    id: 'date',
    examples: ['Max, que dia é hoje?'],
    match: (q) =>
      q.re(/\b(que dia e hoje|qual (e )?(o )?dia de hoje|dia e hoje|qual (e )?a data|data de hoje|que data e hoje|que dia da semana|dia da semana e hoje|em que dia estamos|em que mes estamos|em que ano estamos|hoje e que dia)\b/)
        ? 0.94
        : 0,
    run: () => ({ say: `Hoje é ${dateText().replace(/^./, (c) => c.toLowerCase())}.`, text: `${dateText()}.` }),
  },

  /* ---------- contas ---------- */
  {
    id: 'calc',
    examples: ['Max, quanto é 15% de 2400?'],
    match: (q) => (tryCalc(q.raw) ? 0.92 : 0),
    run: (q) => {
      const r = tryCalc(q.raw)!;
      if (!Number.isFinite(r.value)) return { say: 'Não dá para dividir por zero.' };
      return { say: `O resultado é ${r.text}.`, text: `= ${r.text}` };
    },
  },

  /* ---------- conversa ---------- */
  {
    id: 'thanks',
    match: (q) => (q.re(/\b(obrigad[oa]|valeu|vlw|agradec\w+|brigad[oa]|thanks|gratidao|show de bola|perfeito max|otimo max)\b/) && q.tokens.length <= 6 ? 0.9 : 0),
    run: (_q, host) => ({ say: pick([`Por nada${name(host)}!`, 'Disponha!', 'Sempre que precisar.', 'Estou aqui para isso.']) }),
  },
  {
    id: 'bye',
    match: (q) => (q.re(/^(tchau|ate logo|ate mais|ate amanha|ate breve|falou|fui|adeus|bye|ate a proxima|bom descanso|bom trabalho)( max)?$/) ? 0.92 : 0),
    run: (_q, host) => ({ say: pick([`Até logo${name(host)}!`, 'Até mais! Bom trabalho.', 'Até a próxima.']) }),
  },
  {
    id: 'how-are-you',
    match: (q) => (q.re(/\b(tudo bem|tudo bom|como vai|como voce esta|como (vc|voce) ta|como vai voce|tudo certo|tudo joia|tudo tranquilo|como estao as coisas)\b/) && q.tokens.length <= 7 ? 0.86 : 0),
    run: (_q, host) => ({ say: pick([`Tudo ótimo por aqui${name(host)}. E com você?`, 'Tudo em ordem, sistemas funcionando. Em que posso ajudar?', 'Tudo certo! Pronta para ajudar.']) }),
  },
  {
    id: 'smalltalk',
    match: (q) => {
      if (q.re(/\b(piada|me faz rir|conta uma|algo engracado)\b/)) return 0.88;
      if (q.re(/\b(quem (te |lhe )?(criou|fez|desenvolveu|programou|inventou)|quem e seu criador|de onde voce (vem|veio)|quem (criou|fez) voce)\b/)) return 0.9;
      if (q.re(/\b(quantos anos voce tem|qual (e )?(a )?sua idade|voce e (uma )?(mulher|homem|pessoa|humana|robo|ia|inteligencia artificial|real)|voce (dorme|come|sente|pensa|tem sentimentos|esta viva)|voce e de verdade)\b/)) return 0.88;
      if (q.re(/\b(te amo|gosto de voce|voce e (linda|legal|incrivel|demais|otima|top|inteligente|esperta|a melhor|maravilhosa)|parabens|mandou bem|boa max)\b/)) return 0.86;
      if (q.re(/\b(burra|idiota|inutil|lixo|chata|estupida|odeio voce|voce e ruim|nao serve)\b/)) return 0.86;
      if (q.re(/\b(cara ou coroa|joga (uma )?moeda|jogue (uma )?moeda|lanca (uma )?moeda)\b/)) return 0.9;
      if (q.re(/\b(jog\w+ (um |o )?dado|rol\w+ (um |o )?dado|lanc\w+ (um |o )?dado|sorteie um numero|numero aleatorio)\b/)) return 0.9;
      if (q.re(/\b(sentido da vida|voce acredita em deus|qual seu time|qual e o seu time|sua cor (favorita|preferida)|comida (favorita|preferida))\b/)) return 0.85;
      if (q.re(/^(teste|testando|um dois tres|1 2 3|alo alo|ta me ouvindo|esta me ouvindo|voce me ouve|me escuta|ta ai|esta ai|voce esta ai)( testando)?$/)) return 0.9;
      return 0;
    },
    run: (q, host) => {
      if (q.re(/\b(piada|me faz rir|conta uma|algo engracado)\b/)) {
        return {
          say: pick([
            'Por que o vigilante levou uma escada para o trabalho? Para subir de posto.',
            'O que o estoque falou para a planilha? Você não me controla mais.',
            'Por que o computador foi ao médico? Porque estava com um vírus.',
            'Qual é o café mais perigoso do mundo? O ex-presso.',
            'O que o zero disse para o oito? Belo cinto!',
          ]),
        };
      }
      if (q.re(/\b(criou|fez|desenvolveu|programou|inventou|criador|vem|veio)\b/)) {
        return { say: 'Fui criada pela equipe do Max Hub para facilitar o dia a dia de todos os setores da empresa.' };
      }
      if (q.re(/\b(anos|idade|mulher|homem|pessoa|humana|robo|ia|inteligencia|real|dorme|come|sente|pensa|sentimentos|viva|verdade)\b/)) {
        return { say: 'Sou uma assistente virtual: não tenho idade nem corpo, mas estou sempre de plantão aqui no Max Hub.' };
      }
      if (q.re(/\b(cara ou coroa|moeda)\b/)) return { say: `Deu ${pick(['cara', 'coroa'])}.` };
      if (q.re(/\b(dado|numero aleatorio|sorteie)\b/)) return { say: `Saiu o número ${1 + Math.floor(Math.random() * 6)}.` };
      if (q.re(/\b(burra|idiota|inutil|lixo|chata|estupida|odeio|ruim|nao serve)\b/)) {
        return { say: 'Sinto muito se não ajudei. Diga de outro jeito o que você precisa e eu tento de novo.' };
      }
      if (q.re(/\b(sentido da vida)\b/)) return { say: 'Dizem que é 42. Eu fico com manter tudo organizado.' };
      if (q.re(/\b(time|cor|comida|deus)\b/)) return { say: 'Prefiro não tomar partido. Mas o lilás do Max Hub me cai muito bem.' };
      if (q.re(/^(teste|testando|um dois tres|1 2 3|alo alo|ta me ouvindo|esta me ouvindo|voce me ouve|me escuta|ta ai|esta ai|voce esta ai)/)) {
        return { say: `Estou ouvindo você perfeitamente${name(host)}.` };
      }
      return { say: pick([`Obrigada${name(host)}!`, 'Que bom ouvir isso!', 'Fico feliz em ajudar.']) };
    },
  },

  /* ---------- tela de login ---------- */
  {
    id: 'login-help',
    scopes: ['login'],
    examples: ['Max, como faço para entrar?'],
    match: (q) =>
      q.re(/\b(como (eu )?(faco|fazer) (para |pra |o )?(entrar|login|logar|acessar)|como (entro|acesso|logo)|nao consigo (entrar|acessar|logar)|esqueci (a |minha )?(senha|usuario|login)|perdi (a |minha )?senha|recuperar (a )?senha|trocar (a )?senha|qual (e )?(a )?minha senha|qual (e )?(o )?meu usuario|nao tenho (usuario|senha|acesso|cadastro|login)|criar (uma )?conta|me cadastrar|primeiro acesso)\b/)
        ? 0.92
        : 0,
    run: (q) => {
      if (q.re(/\b(esqueci|perdi|recuperar|qual (e )?(a )?minha senha|qual (e )?(o )?meu usuario)\b/)) {
        return { say: 'Por segurança, eu não vejo senhas. Peça ao master do seu setor, ou ao administrador do Max Hub, para definir uma senha nova para você.' };
      }
      if (q.re(/\b(nao tenho|criar|cadastrar|primeiro acesso)\b/)) {
        return { say: 'Os acessos são criados pelo administrador do Max Hub. Peça a ele um usuário e uma senha. No primeiro acesso, troque a senha em Minha conta.' };
      }
      return { say: 'Digite seu usuário e sua senha nos campos abaixo e clique em Entrar. Eu levo você direto para a ferramenta do seu setor.' };
    },
  },
  {
    id: 'open-request-form',
    scopes: ['login'],
    examples: ['Max, quero fazer uma solicitação'],
    match: (q) =>
      q.any('solicitacao', 'solicitar', 'pedido', 'requisicao', 'fardamento', 'uniforme', 'epi') || q.re(/\b(sou supervisor|formulario)\b/) ? 0.88 : 0,
    run: (_q, host) => ({
      say: 'Abrindo o formulário de solicitação do almoxarifado.',
      afterSpeech: () => host.navigate('/solicitacao'),
    }),
  },

  /* ---------- conta e sessão ---------- */
  {
    id: 'whoami',
    scopes: ['hub', 'sector'],
    examples: ['Max, qual é o meu setor?'],
    match: (q) => (q.re(/\b(quem sou eu|qual (e )?(o )?meu (setor|usuario|nome|acesso|perfil|cargo)|minhas permissoes|meu acesso|o que eu posso fazer|com que usuario)\b/) ? 0.9 : 0),
    run: (_q, host) => {
      const u = host.user;
      if (!u) return { say: 'Ainda estou carregando os seus dados. Tente de novo em instantes.' };
      if (u.is_master) return { say: `Você é ${u.display_name}, master geral do Max Hub: tem acesso a todos os setores e ao cadastro de usuários.`, text: `${u.display_name} (@${u.username}) · master geral` };
      const s = getSector(u.sector);
      const role = u.sector_role === 'master' ? 'master do setor' : 'membro da equipe';
      return {
        say: `Você é ${u.display_name}, ${role} ${s ? s.name : 'sem setor definido'}.`,
        text: `${u.display_name} (@${u.username}) · ${role}${s ? ' · ' + s.name : ''}`,
      };
    },
  },
  {
    id: 'logout',
    scopes: ['hub', 'sector'],
    examples: ['Max, sair'],
    match: (q) =>
      q.re(/^(sair|sair do sistema|sair da conta|sair da minha conta|deslogar|desconectar|logout|log out|fazer logout|encerrar (a )?sessao|finalizar (a )?sessao|quero sair|me desloga|pode sair|encerrar)$/) ? 0.95 : 0,
    run: (_q, host) => ({ say: `Encerrando a sua sessão. Até logo${name(host)}!`, afterSpeech: () => host.logout() }),
  },

  /* ---------- navegação ---------- */
  {
    id: 'go-sector',
    scopes: ['hub', 'sector'],
    examples: ['Max, abrir o setor financeiro'],
    match: (q, host) => {
      if (!host.user?.is_master) return 0;
      if (q.re(/\b(painel (master|principal|geral|administrativo)|tela (master|principal|inicial)|pagina (inicial|principal)|hub)\b/) && (q.any(...VERB_GO) || q.tokens.length <= 3)) return host.scope === 'hub' ? 0 : 0.93;
      const target = SECTORS.find((s) => s.aliases.some((a) => q.any(a)) || q.any(s.name));
      if (!target) return 0;
      if (host.sector?.slug === target.slug) return 0;
      const saysSector = q.any('setor', 'ferramenta', 'painel', 'area', 'departamento');
      if (q.any(...VERB_GO) && saysSector) return 0.94;
      if (host.scope === 'hub' && q.any(...VERB_GO) && !q.any('usuario', 'usuarios', 'pessoas', 'equipe', 'quem', 'master', 'quantos', 'quantas')) return 0.9;
      if (q.any(...VERB_GO) && !host.tabs.some((t) => t.aliases.some((a) => q.any(a)))) return 0.8;
      return 0;
    },
    run: (q, host) => {
      if (q.re(/\b(painel (master|principal|geral|administrativo)|tela (master|principal|inicial)|pagina (inicial|principal)|hub)\b/) && !SECTORS.some((s) => s.aliases.some((a) => q.any(a)))) {
        return { say: 'Voltando ao painel master.', afterSpeech: () => host.navigate('/hub') };
      }
      const target = SECTORS.find((s) => s.aliases.some((a) => q.any(a)) || q.any(s.name))!;
      return { say: `Abrindo o setor ${target.name}.`, afterSpeech: () => host.navigate(sectorPath(target.slug)) };
    },
  },
  {
    id: 'go-tab',
    scopes: ['hub', 'sector'],
    examples: ['Max, abrir minha conta'],
    match: (q, host) => {
      const tab = host.tabs.find((t) => t.aliases.some((a) => q.any(a)) || q.any(t.label));
      if (!tab) return 0;
      if (q.any(...VERB_GO)) return 0.84;
      return q.tokens.length <= 3 ? 0.72 : 0;
    },
    run: (q, host) => {
      const tab = host.tabs.find((t) => t.aliases.some((a) => q.any(a)) || q.any(t.label))!;
      if (tab.id === host.tab) return { say: `Você já está em ${tab.label}.` };
      return { say: `Abrindo ${tab.label}.`, act: () => host.goTab(tab.id) };
    },
  },
];
