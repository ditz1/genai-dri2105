// Sample people that fill out the board until enough real members have joined.
export const boardSize = 12;

export const placeholderProfiles = [
  ['Ada', 'Okafor'],
  ['Mateo', 'Rivera'],
  ['Yuki', 'Tanaka'],
  ['Priya', 'Nair'],
  ['Jonas', 'Lindqvist'],
  ['Amara', 'Diallo'],
  ['Leila', 'Haddad'],
  ['Tomás', 'Silva'],
  ['Mei', 'Chen'],
  ['Noah', 'Becker'],
  ['Zainab', 'Yusuf'],
  ['Elena', 'Petrova'],
].map(([first_name, last_name], index) => ({
  id: `placeholder-${index}`,
  first_name,
  last_name,
  avatar_path: null,
  placeholder: true,
}));
