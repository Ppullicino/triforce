document.querySelector('#login').addEventListener('submit', async event => {
  event.preventDefault();
  const token = new FormData(event.currentTarget).get('token');
  const response = await fetch('/api/session', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token })
  });
  if (response.ok) location.replace('/');
  else document.querySelector('#error').textContent = 'Invalid access token.';
});
