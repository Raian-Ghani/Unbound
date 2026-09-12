// ===== Live match preview =====

const pillGrid = document.getElementById('pillGrid');
const previewResults = document.getElementById('previewResults');
const interestForm = document.getElementById('interestForm');
const customInterests = document.getElementById('customInterests');
const selectedTags = new Set();

pillGrid.addEventListener('click', (e) => {
  const pill = e.target.closest('.pill');
  if (!pill) return;

  const tag = pill.dataset.tag;
  pill.classList.toggle('active');
  selectedTags.has(tag) ? selectedTags.delete(tag) : selectedTags.add(tag);

  renderMatches();
});

interestForm.addEventListener('submit', (event) => {
  event.preventDefault();
  customInterests.value
    .split(',')
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean)
    .forEach((tag) => selectedTags.add(tag));
  customInterests.value = '';
  renderMatches();
});

function jaccardScore(a, b) {
  const setA = new Set(a);
  const setB = new Set(b);
  const intersection = [...setA].filter((t) => setB.has(t));
  const union = new Set([...setA, ...setB]);
  return union.size === 0 ? 0 : intersection.length / union.size;
}

function renderMatches() {
  if (selectedTags.size === 0) {
    previewResults.innerHTML = '<p class="preview-empty">Choose an interest or add your own to see community matches.</p>';
    return;
  }

  const picked = [...selectedTags];
  const scored = communityProfiles
    .map((p) => ({ ...p, score: jaccardScore(picked, p.tags) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  if (scored.length === 0) {
    previewResults.innerHTML = '<p class="preview-empty">There are no other profiles to compare yet. Invite someone who shares your interests.</p>';
    return;
  }

  previewResults.innerHTML = `<div class="match-grid">${scored
    .map((p) => {
      const pct = Math.round(p.score * 100);
      const shared = p.tags.filter((t) => selectedTags.has(t));
      return `
        <div class="match-card">
          <h4>${p.name}</h4>
          <div class="match-score">${pct}% interest overlap</div>
          <div class="match-bar"><div class="match-bar-fill" style="width:${pct}%"></div></div>
          <div class="match-tags">${shared.length ? `Shares: ${shared.join(', ')}` : 'Closest available profile for now.'}</div>
        </div>`;
    })
    .join('')}</div>`;
}

let communityProfiles = [];

async function loadCommunityProfiles() {
  const response = await fetch('/api/matches');
  const data = await response.json();
  if (!response.ok) return;

  const tagsByProfile = new Map();
  data.interests.forEach((interest) => {
    const tags = tagsByProfile.get(interest.profile_id) || [];
    tags.push(interest.tag);
    tagsByProfile.set(interest.profile_id, tags);
  });
  communityProfiles = data.profiles.map((profile) => ({
    ...profile,
    tags: tagsByProfile.get(profile.id) || [],
  }));
  if (selectedTags.size > 0) renderMatches();
}

loadCommunityProfiles();

// ===== Account form =====
const joinForm = document.getElementById('joinForm');
const formNote = document.getElementById('formNote');

joinForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const name = joinForm.name.value.trim();
  const email = joinForm.email.value.trim();
  const password = joinForm.password.value;
  const ageGroup = joinForm.ageGroup.value;
  const interests = joinForm.interests.value
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);

  if (!name || !email || password.length < 8 || !ageGroup) {
    formNote.textContent = 'Fill in every field and use a password with at least 8 characters.';
    formNote.className = 'form-note error';
    return;
  }

  try {
    const res = await fetch('/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password, age_group: ageGroup, interests }),
    });
    const data = await res.json();

    if (!res.ok) throw new Error(data.error || 'Something went wrong.');

    if (data.status === 'ok') {
      window.location.href = '/profile';
      return;
    }

    formNote.textContent = data.status === 'check_email'
      ? `Your account is ready, ${name}. Confirm your email at ${email} to finish signing in.`
      : `Your account is ready, ${name}.`;
    formNote.className = 'form-note success';
    joinForm.reset();
  } catch (err) {
    formNote.textContent = err.message;
    formNote.className = 'form-note error';
  }
});

const loginForm = document.getElementById('loginForm');
const loginNote = document.getElementById('loginNote');

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  loginNote.textContent = '';

  try {
    const response = await fetch('/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: document.getElementById('loginEmail').value.trim(),
        password: document.getElementById('loginPassword').value,
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not log in.');
    window.location.href = '/profile';
  } catch (error) {
    loginNote.textContent = error.message;
    loginNote.className = 'form-note error';
  }
});
