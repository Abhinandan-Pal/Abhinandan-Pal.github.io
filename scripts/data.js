// scripts/data.js
//
// Canonical content source for the website.
//
// This module exports a single `content` object that mirrors  of
// `/ and matches the
// `PageContent` schema in `/
// (`Data Models › Schema`).
//
// Contract:
// - This is the *single source of truth* for all Owner content. Any text the
//   Website displays inside a section is sourced from here.
// - `render.js` consumes this object to populate / verify section markup.
// - Tests compare the rendered DOM against this object.
// - Every entry that has an associated date carries a stable ISO-style
//   `date` / `startDate` / `endDate` field so that `render.js` and tests can
//   sort lists in non-increasing order without ambiguity.
// - When a list is empty, the corresponding section and nav link are
//   omitted at render time.
//

/**
 * @typedef {Object} Identity
 * @property {string} name
 * @property {string} bengali
 * @property {string} nickname
 * @property {string} origin
 * @property {string} role
 * @property {string} affiliation
 * @property {string} group
 * @property {string} topic
 * @property {{ name: string, url: string }} primarySupervisor
 * @property {{ name: string, url: string }} industrySupervisor
 * @property {string[]} emails
 * @property {string} linkedin
 * @property {string} github
 * @property {string[]} previousAffiliations
 *
 * @typedef {Object} Link
 * @property {"Paper" | "Talk" | "Poster" | "arXiv" | "Slides"} label
 * @property {string} href
 *
 * @typedef {Object} Publication
 * @property {string} venue
 * @property {string} title
 * @property {string} authors
 * @property {string} meta
 * @property {string} date
 * @property {Link[]} links
 *
 * @typedef {Object} Experience
 * @property {string} role
 * @property {string} institution
 * @property {string} location
 * @property {string} startDate
 * @property {string} endDate
 * @property {string[]} bullets
 *
 * @typedef {Object} Training
 * @property {string} qualification
 * @property {string} institution
 * @property {string} location
 * @property {string} startDate
 * @property {string} endDate
 * @property {string[]} bullets
 *
 * @typedef {Object} Award
 * @property {string} name
 * @property {string} date
 * @property {string} description
 *
 * @typedef {Object} Teaching
 * @property {"PGTA" | "Invited Talk" | "Seminar" | "Talk"} kind
 * @property {string} title
 * @property {string} institution
 * @property {string} term
 * @property {string} date
 * @property {string} description
 *
 * @typedef {Object} Service
 * @property {number} year
 * @property {string} headline
 * @property {string[]} bullets
 * @property {{ label: string, href: string }[]} [links]
 *
 * @typedef {Object} Contact
 * @property {string[]} emails
 * @property {string} linkedin
 * @property {string} github
 *
 * @typedef {Object} Paragraph
 * @property {string} html
 *
 * @typedef {Object} PageContent
 * @property {Identity} identity
 * @property {Publication[]} publications
 * @property {Experience[]} experience
 * @property {Training[]} training
 * @property {Award[]} awards
 * @property {Teaching[]} teaching
 * @property {Service[]} service
 * @property {Paragraph[]} nmcSummary
 * @property {Contact} contact
 */

/** @type {Identity} */
const identity = {
  name: 'Abhinandan Pal',
  bengali: 'অভিনন্দন পাল',
  nickname: 'Obi',
  origin: 'Chinsurah, West Bengal, India',
  role: 'PhD Candidate',
  affiliation: 'School of Computer Science, University of Birmingham',
  group: 'Theory of Computer Science',
  topic: 'Neural Model Checking',
  primarySupervisor: {
    name: 'Mirco Giacobbe',
    url: 'https://mircogiacobbe.github.io/',
  },
  industrySupervisor: {
    name: 'Daniel Kröning',
    url: 'https://www.kroening.com/',
  },
  emails: ['a.pal@bham.ac.uk', 'abhinandan.mike123@gmail.com'],
  linkedin: 'https://www.linkedin.com/in/abhinandan-pal-obi-88788a192/',
  github: 'https://github.com/Abhinandan-Pal',
  previousAffiliations: [
    'IIIT Kalyani',
    'École Normale Supérieure (Paris)',
    'École Normale Supérieure Paris-Saclay',
    'Università degli Studi di Padova',
    'National Institute of Informatics, Tokyo',
    'Amazon (New York, Applied Science Intern)',
  ],
};

/** @type {Publication[]} — sorted descending by `date`. */
const publications = [
  {
    venue: "NeurIPS'25",
    title: 'Let a Neural Network be Your Invariant',
    authors: 'Mirco Giacobbe, Daniel Kröning, Abhinandan Pal, Michael Tautschnig (alphabetical)',
    meta: 'In Advances in Neural Information Processing Systems 38 (NeurIPS 2025), December 2-7, 2025, San Diego, USA.',
    date: '2025-12',
    links: [{ label: 'Paper', href: 'https://openreview.net/forum?id=qBPb7g1SEa' }],
  },
  {
    venue: "NeurIPS'24",
    title: 'Neural Model Checking',
    authors: 'Mirco Giacobbe, Daniel Kröning, Abhinandan Pal, Michael Tautschnig (alphabetical)',
    meta: 'In Advances in Neural Information Processing Systems 37 (NeurIPS 2024), December 9-15, 2024, Vancouver, Canada.',
    date: '2024-12',
    links: [
      { label: 'Paper', href: 'https://openreview.net/forum?id=dJ9KzkQ0oH' },
    ],
  },
  {
    venue: "VMCAI'24",
    title: 'Abstract Interpretation-Based Feature Importance for Support Vector Machines',
    authors: 'Abhinandan Pal, Francesco Ranzato, Caterina Urban, Marco Zanella',
    meta: 'In International Conference on Verification, Model Checking, and Abstract Interpretation, January 15-16, 2024, London, United Kingdom.',
    date: '2024-01',
    links: [{ label: 'Paper', href: 'https://inria.hal.science/hal-04378817/document' }],
  },
  {
    venue: "POPL SRC'24",
    title: 'PiR (πr): Probabilistic Interpretation of Robustness',
    authors: 'Abhinandan Pal',
    meta: 'Extended Abstract for the Student Research Competition track of the 51st ACM SIGPLAN Symposium on Principles of Programming Languages, January 14–20, 2024, London, United Kingdom.',
    date: '2024-01',
    links: [],
  },
  {
    venue: "SPLASH SRC'22",
    title: 'Qiwi: A Beginner Friendly Quantum Language',
    authors: 'Abhinandan Pal, Anubhab Ghosh',
    meta: 'In Companion Proceedings of the 2022 ACM SIGPLAN International Conference on Systems, Programming, Languages, and Applications: Software for Humanity, December 5–10, 2022, Auckland, New Zealand.',
    date: '2022-12',
    links: [{ label: 'Paper', href: 'https://dl.acm.org/doi/abs/10.1145/3563768.3563959' }],
  },
];

/** @type {Experience[]} — sorted descending by `startDate`. */
const experience = [
  {
    role: 'Applied Science Intern',
    institution: 'Amazon New York',
    location: 'USA',
    startDate: '2025-11',
    endDate: '2026-01',
    bullets: [
      'Team: Security.',
      'Building language-agnostic declarative rule matching at industrial scale.',
    ],
  },
  {
    role: 'Research Intern',
    institution: 'National Institute of Informatics Tokyo',
    location: 'Japan',
    startDate: '2025-03',
    endDate: '2025-07',
    bullets: [
      'Advisor: Dr. Taro Sekiyama.',
      'Extending neural model checking to software verification.',
    ],
  },
  {
    role: 'Research Intern',
    institution: 'École Normale Supérieure Paris',
    location: 'in-person/remote',
    startDate: '2022-11',
    endDate: '2023-04',
    bullets: [
      'Advisor: Dr. Caterina Urban.',
      'Verifying attention robustness of CNNs using abstract interpretation.',
    ],
  },
  {
    role: 'Research Intern',
    institution: 'Università degli Studi di Padova',
    location: 'remote',
    startDate: '2022-05',
    endDate: '2022-07',
    bullets: [
      'Advisors: Dr. Caterina Urban, Prof. Francesco Ranzato, Dr. Marco Zanella.',
      'Developing feature ranking and fairness analysis of SVMs using abstract interpretation.',
    ],
  },
  {
    role: 'Research Intern',
    institution: 'École Normale Supérieure',
    location: 'remote',
    startDate: '2021-11',
    endDate: '2022-01',
    bullets: [
      'Advisor: Dr. Caterina Urban.',
      'Redesigning a static analysis for certifying fairness of neural networks, exploiting GPU parallelism.',
    ],
  },
  {
    role: 'Research Intern',
    institution: 'École Normale Supérieure Paris-Saclay',
    location: 'remote',
    startDate: '2021-06',
    endDate: '2021-07',
    bullets: [
      'Advisor: Prof. Mihaela Sighireanu.',
      'Developing specification-based tests for POSIX utilities manipulating the file system.',
    ],
  },
  {
    role: 'General Secretary Technology',
    institution: 'IIIT Kalyani Student Council',
    location: 'India',
    startDate: '2021-08',
    endDate: '2022-11',
    bullets: [
      'Launching new technical clubs and regular events, several focused on student well-being during the pandemic.',
    ],
  },
];

/** @type {Training[]} — sorted descending by `endDate`. */
const training = [
  {
    qualification: 'PhD, School of Computer Science',
    institution: 'University of Birmingham',
    location: 'Birmingham, UK',
    startDate: '2023-09',
    endDate: '2027-09',
    bullets: [],
  },
  {
    qualification: 'B.Tech. Computer Science and Engineering',
    institution: 'IIIT Kalyani',
    location: 'Kalyani, India',
    startDate: '2019-08',
    endDate: '2023-07',
    bullets: ['CGPA 9.95 (Department Rank 1).'],
  },
  {
    qualification: 'Indian School Certificate Examinations',
    institution: 'Don Bosco School Bandel',
    location: 'Hooghly, India',
    startDate: '2010-04',
    endDate: '2019-04',
    bullets: ['ICSE 2017 — 94%.', 'ISC 2019 — 95.25%.'],
  },
];

/** @type {Award[]} — sorted descending by `date`. */
const awards = [
  {
    name: 'President of India Gold Medal',
    date: '2023-12',
    description: 'Awarded for academic excellence to one student at each INI (IIT, IIIT, NIT, etc.).',
  },
  {
    name: "ENS Saclay Master's Scholarship",
    date: '2023-06',
    description: 'Awarded; declined to pursue PhD.',
  },
  {
    name: "ENS Lyon Master's Scholarship",
    date: '2023-03',
    description: 'Awarded; declined to pursue PhD.',
  },
  {
    name: "ACM SRC Bronze Medal at SPLASH'22",
    date: '2022-12',
    description:
      'Bronze medal in the ACM Student Research Competition at SPLASH 2022 for Qiwi: A Beginner Friendly Quantum Language.',
  },
];

/** @type {Teaching[]} — sorted descending by `date`. */
const teaching = [
  {
    kind: 'Invited Talk',
    title: 'Neural Model Checking',
    institution: 'New York University, Princeton University, University of Illinois Urbana-Champaign, Mitsubishi Electric Research Laboratories',
    term: 'Autumn 2025',
    date: '2025-09',
    description: 'Invited talk on Neural Model Checking.',
  },
  {
    kind: 'Invited Talk',
    title: 'Neural Model Checking',
    institution: 'University of Edinburgh, University of Bristol, Imperial College London',
    term: 'Spring 2025',
    date: '2025-03',
    description: 'Invited talk on Neural Model Checking.',
  },
  {
    kind: 'Invited Talk',
    title: 'OXCAV seminar',
    institution: 'University of Oxford',
    term: 'Spring 2024',
    date: '2024-03',
    description: 'Invited talk on Abstract Interpretation-Based Feature Importance for Support Vector Machines.',
  },
  {
    kind: 'Teaching Assistant',
    title: 'Team Project (BSc CS, year 2)',
    institution: 'University of Birmingham',
    term: 'Spring 2024',
    date: '2024-01',
    description: 'Postgraduate Teaching Assistant.',
  },
  {
    kind: 'Teaching Assistant',
    title: 'Data Structures and Algorithms (Conversion MSc CS)',
    institution: 'University of Birmingham',
    term: 'Spring 2024',
    date: '2024-01',
    description: 'Postgraduate Teaching Assistant.',
  },
  {
    kind: 'Teaching Assistant',
    title: 'Computer-Aided Verification (BSc/MSci CS, years 3 and 4)',
    institution: 'University of Birmingham',
    term: 'Autumn 2023',
    date: '2023-10',
    description: 'Postgraduate Teaching Assistant.',
  },
  {
    kind: 'Seminar',
    title: 'Antique Seminar',
    institution: 'École Normale Supérieure',
    term: 'Spring 2023',
    date: '2023-03',
    description: 'Research seminar talk at ENS.',
  },
];

/** @type {Service[]} — sorted descending by `year`. */
const service = [
  {
    year: 2025,
    headline: "General Chair, BASiC'25",
    bullets: [
      'Chairing the Birmingham Algorithms, Synthesis, and Computability seminar series.',
    ],
  },
  {
    year: 2025,
    headline: 'PGR Representative, UoB CS Research Committee (2024–2025)',
    bullets: [],
  },
  {
    year: 2024,
    headline: 'Artifact Evaluation Committee Member',
    bullets: ["CAV'24, SAS'24, ECOOP'24."],
  },
  {
    year: 2024,
    headline: 'Mentor, SIGPLAN-M (2024–present)',
    bullets: [],
  },
  {
    year: 2023,
    headline: "Student Volunteer, CIKM'23",
    bullets: [],
  },
];

/** @type {Contact} */
const contact = {
  emails: ['a.pal@bham.ac.uk', 'abhinandan.mike123@gmail.com'],
  linkedin: 'https://www.linkedin.com/in/abhinandan-pal-obi-88788a192/',
  github: 'https://github.com/Abhinandan-Pal',
};

/** @type {Paragraph[]} — Neural Model Checking research summary, two paragraphs. */
const nmcSummary = [
  {
    html:
      '<strong>Neural Model Checking</strong> sits at the intersection of formal verification and machine learning. Working with <a href="https://mircogiacobbe.github.io/">Mirco Giacobbe</a> and <a href="https://www.kroening.com/">Daniel Kröning</a> at the <a href="https://www.birmingham.ac.uk/">University of Birmingham</a>, the line of work trains neural networks as <em>inductive invariants</em> for non-deterministic, discrete-time dynamical systems and then certifies them with off-the-shelf SMT solvers. The network proposes; the solver disposes. A counter-example refutes a candidate witness; iteration refines the network until the property holds.',
  },
  {
    html:
      'Why it matters: the approach yields scalable, certificate-bearing safety proofs for systems whose state spaces defeat traditional model checking, while keeping soundness in the hands of a symbolic checker rather than the learner. Recent work shows the method generalises beyond reachability — to <em>liveness</em> and richer temporal properties — opening a path toward neural certificates for full <strong>LTL</strong>-style specifications.',
  },
];

/** @type {PageContent} */
export const content = {
  identity,
  publications,
  experience,
  training,
  awards,
  teaching,
  service,
  nmcSummary,
  contact,
};

export default content;
