const demoTargets = [
  { id: 'target-maya', name: 'Maya Chen', role: 'Founder', company: 'Northstar Labs', platform: 'LinkedIn', match: 96, status: 'Ready', initials: 'MC' },
  { id: 'target-jon', name: 'Jon Bell', role: 'VP Growth', company: 'Frame.io', platform: 'LinkedIn', match: 91, status: 'Ready', initials: 'JB' },
  { id: 'target-aisha', name: 'Aisha Okafor', role: 'Operator', company: 'Bloom Commerce', platform: 'Instagram', match: 87, status: 'Review', initials: 'AO' }
];

export const providers = {
  demo: {
    name: 'Consent-safe demo provider',
    async discover() { return demoTargets.map(target => ({ ...target })); }
  },
  linkedin: {
    name: 'LinkedIn official API adapter',
    async discover() { throw new Error('LinkedIn discovery requires an approved official API integration.'); }
  },
  instagram: {
    name: 'Instagram Graph API adapter',
    async discover() { throw new Error('Instagram discovery requires an approved Graph API integration.'); }
  }
};

export async function discoverTargets(providerName = 'demo') {
  const provider = providers[providerName];
  if (!provider) throw new Error('Unknown discovery provider.');
  return provider.discover();
}
