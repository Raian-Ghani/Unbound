const profileContent = document.getElementById('profileContent');
const profileTitle = document.getElementById('profileTitle');
const profileEmail = document.getElementById('profileEmail');
const profileNote = document.getElementById('profileNote');
const profileInterests = document.getElementById('profileInterests');
const connectionForm = document.getElementById('connectionForm');
const connectionNote = document.getElementById('connectionNote');
const connectedAccounts = document.getElementById('connectedAccounts');
const discoveryPanel = document.getElementById('discoveryPanel');
const discoveryList = document.getElementById('discoveryList');

let currentInterests = [];
let linkedAccounts = [];

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;',
  }[character]));
}

async function loadProfile() {
  const response = await fetch('/api/profile');
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Could not load your profile.');

  const profile = data.profile;
  currentInterests = data.interests.map((interest) => interest.tag);
  linkedAccounts = data.linked_accounts;
  profileTitle.textContent = profile.name;
  profileEmail.textContent = data.email;
  document.getElementById('profileName').textContent = profile.name;
  document.getElementById('profileAge').textContent = profile.age_group;
  document.getElementById('profileBio').textContent = profile.bio || 'No bio yet.';
  profileInterests.innerHTML = data.interests.length
    ? data.interests.map((interest) => `<span class="profile-tag">${interest.tag}</span>`).join('')
    : '<span class="profile-muted">No interests added yet.</span>';
  profileContent.hidden = false;
  renderLinkedAccounts();
}

function renderLinkedAccounts() {
  connectedAccounts.innerHTML = linkedAccounts.length
    ? linkedAccounts.map((account) => `
      <div class="connected-account">
        <div><strong>${escapeHtml(account.provider)}</strong><span>${escapeHtml(account.provider_user_id)}</span></div>
        <button type="button" class="text-button" data-remove-account="${account.id}">Disconnect</button>
      </div>`).join('')
    : '<p class="profile-muted">No platforms connected yet.</p>';
  renderDiscovery();
}

function renderDiscovery() {
  if (!linkedAccounts.length) {
    discoveryPanel.hidden = true;
    return;
  }

  discoveryPanel.hidden = false;
  const interestLabel = currentInterests.length
    ? escapeHtml(currentInterests.slice(0, 2).join(' and '))
    : 'shared interests';
  discoveryList.innerHTML = linkedAccounts.map((account) => `
    <article class="discovery-card">
      <div>
        <strong>Potential ${account.provider} connection</strong>
        <p>Based on ${interestLabel} in your Kindred profile.</p>
      </div>
      <button type="button" class="btn btn-small btn-ghost" data-draft-dm="${account.provider}">Preview DM</button>
      <p class="simulated-message" data-message-for="${account.provider}" hidden></p>
    </article>`).join('');
}

connectionForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  connectionNote.textContent = '';
  const response = await fetch('/api/linked-accounts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      provider: document.getElementById('platform').value,
      handle: document.getElementById('platformHandle').value.trim(),
    }),
  });
  const data = await response.json();
  if (!response.ok) {
    connectionNote.textContent = data.error || 'Could not connect that platform.';
    connectionNote.className = 'form-note error';
    return;
  }
  const existingIndex = linkedAccounts.findIndex((account) => account.provider === data.account.provider);
  if (existingIndex >= 0) linkedAccounts[existingIndex] = data.account;
  else linkedAccounts.push(data.account);
  connectionForm.reset();
  connectionNote.textContent = 'Connected for this Kindred simulation.';
  connectionNote.className = 'form-note success';
  renderLinkedAccounts();
});

connectedAccounts.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-remove-account]');
  if (!button) return;
  await fetch(`/api/linked-accounts/${button.dataset.removeAccount}`, { method: 'DELETE' });
  linkedAccounts = linkedAccounts.filter((account) => String(account.id) !== button.dataset.removeAccount);
  renderLinkedAccounts();
});

discoveryList.addEventListener('click', (event) => {
  const button = event.target.closest('[data-draft-dm]');
  if (!button) return;
  const provider = button.dataset.draftDm;
  const message = document.querySelector(`[data-message-for="${provider}"]`);
  message.textContent = `Simulation ready: “Hi! We both care about ${currentInterests.slice(0, 2).join(' and ') || 'some of the same things'}. Want to connect through Kindred?” Nothing was sent.`;
  message.hidden = false;
  button.textContent = 'Draft ready';
});

document.getElementById('deleteAccountButton').addEventListener('click', async () => {
  if (!window.confirm('Delete your account and all of its profile data? This cannot be undone.')) return;

  const response = await fetch('/api/account', { method: 'DELETE' });
  const data = await response.json();
  if (!response.ok) {
    profileNote.textContent = data.error || 'Could not delete your account.';
    return;
  }

  window.location.href = '/';
});

loadProfile().catch((error) => {
  profileTitle.textContent = 'Profile unavailable';
  profileNote.textContent = error.message;
});
