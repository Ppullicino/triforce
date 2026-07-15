export async function readTask(readline, notify = () => {}) {
  const firstLine = await readline.question('Triforce> ');
  if (firstLine.trim().toLowerCase() !== '/paste') return firstLine;

  notify('Multiline mode: paste your prompt, then enter /run on its own line. Enter /cancel to discard it.');
  const lines = [];
  while (true) {
    const line = await readline.question('... ');
    const command = line.trim().toLowerCase();
    if (command === '/run') return lines.join('\n');
    if (command === '/cancel') {
      notify('Multiline prompt cancelled.');
      return null;
    }
    lines.push(line);
  }
}
