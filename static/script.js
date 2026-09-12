// ===== Mobile nav toggle =====
const navToggle = document.querySelector('.nav-toggle');
const navLinks = document.querySelector('.nav-links');

navToggle.addEventListener('click', () => {
  const open = navLinks.classList.toggle('open');
  navToggle.setAttribute('aria-expanded', open);
});

// ===== Live match preview =====
// Mock "other users" a real backend would supply — used only to demo
// how compatibility scoring feels before a person signs up.
const mockProfiles = [
  { name: 'Amara', tags: ['hiking', 'reading', 'travel', 'volunteering'] },
  { name: 'Deng',  tags: ['startups', 'chess', 'reading', 'running'] },
  { name: 'Noor',  tags: ['cooking', 'music', 'art', 'travel'] },
  { name: 'Priya', tags: ['chess', 'gaming', 'film', 'startups'] },
  { name: 'Leo',   tags: ['running', 'hiking', 'volunteering', 'cooking'] },
];

const pillGrid = document.getElementById('pillGrid');
const previewResults = document.getElementById('previewResults');
const selectedTags = new Set();

pillGrid.addEventListener('click', (e) => {
  const pill = e.target.closest('.pill');
  if (!pill) return;

  const tag = pill.dataset.tag;
  pill.classList.toggle('active');
  selectedTags.has(tag) ? selectedTags.delete(tag) : selectedTags.add(tag);

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
    previewResults.innerHTML = '<p class="preview-empty">Pick at least one interest to see who you\'d match with.</p>';
    return;
  }

  const picked = [...selectedTags];
  const scored = mockProfiles
    .map((p) => ({ ...p, score: jaccardScore(picked, p.tags) }))
    .filter((p) => p.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  if (scored.length === 0) {
    previewResults.innerHTML = '<p class="preview-empty">No close matches on those yet — try adding another interest.</p>';
    return;
  }

  previewResults.innerHTML = `<div class="match-grid">${scored
    .map((p) => {
      const pct = Math.round(p.score * 100);
      const shared = p.tags.filter((t) => selectedTags.has(t));
      return `
        <div class="match-card">
          <h4>${p.name}</h4>
          <div class="match-score">${pct}% compatible</div>
          <div class="match-bar"><div class="match-bar-fill" style="width:${pct}%"></div></div>
          <div class="match-tags">Shares: ${shared.join(', ')}</div>
        </div>`;
    })
    .join('')}</div>`;
}

// ===== Waitlist form =====
const joinForm = document.getElementById('joinForm');
const formNote = document.getElementById('formNote');

joinForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const name = joinForm.name.value.trim();
  const email = joinForm.email.value.trim();
  const ageGroup = joinForm.ageGroup.value;
  const interests = joinForm.interests.value
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);

  if (!name || !email || !ageGroup) {
    formNote.textContent = 'Fill in your name, email, and age group to join.';
    formNote.className = 'form-note error';
    return;
  }

  try {
    const res = await fetch(joinForm.action, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, age_group: ageGroup, interests }),
    });
    const data = await res.json();

    if (!res.ok) throw new Error(data.error || 'Something went wrong.');

    formNote.textContent = `You're on the list, ${name}. We'll email you at ${email} when it's your turn.`;
    formNote.className = 'form-note success';
    joinForm.reset();
  } catch (err) {
    formNote.textContent = err.message;
    formNote.className = 'form-note error';
  }
});
