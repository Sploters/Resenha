// Só nos testes (EXIT_WITH_PARENT=1, posto pelo scripts/run-tests.mjs e herdado pelo servidor que cada teste abre): o
// servidor se encerra sozinho quando o processo que o abriu morre. Sem isso, um teste que cai antes de matar o servidor
// deixa ele de pé na porta, e os testes seguintes falam com esse servidor velho, com os dados da rodada anterior
// (no Windows o executor não consegue derrubar o grupo de processos inteiro, como faz no Linux).
// Sem a variável (produção, desenvolvimento) não faz nada.
if (process.env.EXIT_WITH_PARENT === '1') {
  const parent = process.ppid;
  setInterval(() => {
    let alive = process.ppid === parent; // no Linux, o órfão passa a ser filho de outro processo
    if (alive) try { process.kill(parent, 0); } catch (e) { alive = e.code === 'EPERM'; } // no Windows o ppid não muda
    if (!alive) { console.log('  processo que abriu o servidor morreu: encerrando (EXIT_WITH_PARENT)'); process.exit(0); }
  }, 1000).unref();
}
