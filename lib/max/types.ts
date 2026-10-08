import type { HubUser, HubUserRow, Level } from '../permissions';
import type { SectorDef } from '../sectors';
import type { Posto, RequestRow, StockItem } from '../almoxarifado/types';
import type { Query } from './text';

/** Cartão mostrado junto com a resposta da Max. */
export type MaxCard =
  | { kind: 'stats'; title?: string; stats: { label: string; value: string; tone?: 'in' | 'out' | 'warn' | 'plain' }[]; foot?: string }
  | { kind: 'list'; title?: string; rows: { label: string; value?: string; sub?: string }[]; foot?: string };

export interface MaxReply {
  /** o que a Max fala (sem símbolos, pensado para a voz) */
  say: string;
  /** o que aparece escrito; se faltar, usa o `say` */
  text?: string;
  card?: MaxCard;
  /** ação na tela (trocar de aba, abrir algo…), feita junto com a resposta */
  act?: () => void | Promise<void>;
  /** ação depois que ela termina de falar (sair, navegar para outra página) */
  afterSpeech?: () => void;
  /** sugestões de próximos comandos */
  chips?: string[];
  /** de onde veio a resposta (local, wikipedia, clima, ia…) */
  source?: string;
  /** não entendeu: a interface oferece ajuda */
  unknown?: boolean;
}

export type MaxScope = 'login' | 'hub' | 'sector';

export interface MaxTab {
  id: string;
  label: string;
  /** outros jeitos de chamar a aba */
  aliases: string[];
}

/** O que a tela oferece para a Max enxergar e comandar. */
export interface MaxHost {
  scope: MaxScope;
  sector: SectorDef | null;
  user: HubUser | null;
  tabs: MaxTab[];
  tab: string;
  goTab: (id: string) => void;
  can: (moduleId: string, level?: Exclude<Level, 'none'>) => boolean;
  /** vai para outra página do Max Hub */
  navigate: (path: string) => void;
  logout: () => void;
  almox?: {
    requests: () => RequestRow[] | null;
    items: () => StockItem[] | null;
    postos: () => Posto[] | null;
    emailsCount: () => number | null;
  };
  hub?: {
    users: () => HubUserRow[] | null;
  };
}

/** Alteração preparada pela IA, esperando o "sim" da pessoa. É executada pelas rotas normais do sistema. */
export interface PendingAction {
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  path: string;
  body?: Record<string, unknown>;
  /** o que será feito, em uma linha ("saída de 5 unidades de Boné") */
  what: string;
}

export interface MaxMemory {
  /** alterações aguardando confirmação */
  pending?: PendingAction[] | null;
  last: MaxReply | null;
  lastInput: string;
  voiceOn: boolean;
  setVoice: (on: boolean) => void;
}

export interface Skill {
  id: string;
  /** onde a habilidade existe; sem isso, vale em qualquer tela */
  scopes?: MaxScope[];
  /** só dentro da ferramenta deste setor */
  sector?: string;
  /** frases-modelo: viram sugestões na tela e guia para a IA opcional */
  examples?: string[];
  /** 0..1: o quanto a frase parece ser para esta habilidade */
  match: (q: Query, host: MaxHost) => number;
  run: (q: Query, host: MaxHost, mem: MaxMemory) => MaxReply | Promise<MaxReply>;
}
