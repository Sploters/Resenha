// espera antes de tentar reconectar o gateway (n = tentativas seguidas): dobra até 10 s, com sorteio de ±50%. Sem o
// sorteio, quando o servidor reinicia todo mundo cai no mesmo instante e volta no mesmo milissegundo (1, 2, 4, 8 s iguais
// para todos), e o servidor monta centenas de READY de uma vez (scripts/reconnect-storm-test.mjs).
export const reconnectDelay = (n) => Math.round(Math.min(1000 * 2 ** n, 10000) * (0.5 + Math.random()));
