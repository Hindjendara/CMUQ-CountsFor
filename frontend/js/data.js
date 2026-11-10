// ============================================================
// CountsFor — Data Transformation Layer
// Parses API data into trees, indexes, and display-ready structures
// ============================================================

const MAJOR_META = {
  CS: { code: 'CS', label: 'Computer Science',       color: 'cs', degree: 'B.S. in Computer Science' },
  IS: { code: 'IS', label: 'Information Systems',    color: 'is', degree: 'B.S. in Information Systems' },
  BA: { code: 'BA', label: 'Business Administration',color: 'ba', degree: 'B.S. in Business Administration' },
  BS: { code: 'BS', label: 'Biological Sciences',    color: 'bs', degree: 'B.S. in Biological Sciences' },
  AI: { code: 'AI', label: 'Artificial Intelligence', color: 'ai', degree: 'B.S. in Artificial Intelligence' },
  GS: { code: 'GS', label: 'General Studies',         color: 'gs', degree: 'B.S. in General Studies', dataPending: true },
};

const MAJOR_ORDER = ['CS', 'IS', 'BA', 'BS', 'AI'];
// GS has no requirement data yet; add it to MAJOR_ORDER once its spec exists.

const MAJOR_BRAND = {
  CS: '#C41230',
  IS: '#D97706',
  BA: '#2563EB',
  BS: '#059669',
  AI: '#7C3AED',
  GS: '#64748B',
};

// First match in this ordered list wins. rule.color === null means "use major brand".
const ACCENT_RULES = [
  { match: /math|probabil/i,           color: '#6b21a8' },
  { match: /elective|technical/i,      color: '#047857' },
  { match: /humanit|arts|gened/i,      color: '#B45309' },
  { match: /science|lab/i,             color: '#047857' },
  { match: /core|required/i,           color: null /* major brand */ },
];

function pickAccentColor(label, activeMajor) {
  const brand = MAJOR_BRAND[activeMajor] || '#C41230';
  if (!label) return brand;
  for (const rule of ACCENT_RULES) {
    if (rule.match.test(label)) {
      return rule.color || brand;
    }
  }
  return brand;
}

// ── Label overrides for nicer display ──────────────────────
// Bucket names come from the 2026-27 catalog and are shown as they are. Only
// the degree roots and the Biological Sciences track comment rows that do not
// read as a name on their own get a display label; the stored path never
// changes. Show a segment with requirementLeafLabel() or formatRequirementPath().
const LABEL_OVERRIDES = {
  'BS in Computer Science': 'CS Degree Requirements',
  'BS in Information Systems': 'IS Degree Requirements',
  'BS in Business Administration': 'BA Degree Requirements',
  'BS in Biological Sciences': 'Biology Degree Requirements',
  'BS in Artificial Intelligence': 'AI Degree Requirements',
  'And any TWO (2) or THREE (3) of the following for a total of FIVE (5) courses': 'Two or three more courses',
  'And TWO (2) or THREE (3) of the following for a total of FIVE (5) courses': 'Two or three more courses',
  'A maximum of one elective can be (with advisor approval)': 'At most one of these (advisor approval)',
  'A maximum of one elective can be': 'At most one of these',
};

// ── Fulfillment rules (2026-27 catalog) ────────────────────
// One chip per bucket name, per major. findRule() looks up a node's own
// segment first, then its ancestors. Rules are listed in catalog order, and
// normalizeTree() shows sibling buckets in that order.
const FULFILLMENT_RULES = {};

function setRule(major, pathSuffix, rule) {
  if (!FULFILLMENT_RULES[major]) FULFILLMENT_RULES[major] = {};
  FULFILLMENT_RULES[major][pathSuffix] = rule;
}

// CS: Computer Science, B.S. (entering Fall 2026) and SCS General Education
setRule('CS', 'Computer Science', { type: 'take_all', label: 'Complete all' });
setRule('CS', 'Computer Science Core', { type: 'take_all', label: 'Take all' });
setRule('CS', 'One Artificial Intelligence elective', { type: 'pick', n: 1, units: 9, label: 'Choose 1 (at least 9 units)' });
setRule('CS', 'One Domains elective', { type: 'pick', n: 1, units: 9, label: 'Choose 1 (at least 9 units)' });
setRule('CS', '02-180 & 02-181', { type: 'take_all', label: 'Take both' });
setRule('CS', '05-180 & 05-431', { type: 'take_all', label: 'Take both' });
setRule('CS', 'One Logics/Languages elective', { type: 'pick', n: 1, units: 9, label: 'Choose 1 (at least 9 units)' });
setRule('CS', 'One Software Systems elective', { type: 'pick', n: 1, units: 12, label: 'Choose 1 (at least 12 units)' });
setRule('CS', 'Two School of Computer Science electives', { type: 'pick', n: 2, units: 18, label: 'Choose 2 (at least 9 units each)' });
setRule('CS', 'Mathematics', { type: 'take_all', label: 'Complete all' });
setRule('CS', 'All of the following Mathematics courses', { type: 'take_all', label: 'Take all' });
setRule('CS', 'Mathematical Foundations for Computer Science', { type: 'pick', n: 1, label: 'Choose 1' });
setRule('CS', 'Matrices and Linear Transformations', { type: 'pick', n: 1, label: 'Choose 1' });
setRule('CS', 'Calculus in Three Dimensions', { type: 'pick', n: 1, label: 'Choose 1' });
setRule('CS', 'Plus one of the following Probability choices', { type: 'pick', n: 1, label: 'Choose 1' });
setRule('CS', '36-225 & 36-226', { type: 'take_all', label: 'Take both' });
setRule('CS', 'Technical Communication', { type: 'take_all', label: 'Complete all' });
setRule('CS', 'One Technical Communications course', { type: 'pick', n: 1, label: 'Choose 1' });
setRule('CS', 'Computing @ Carnegie Mellon', { type: 'required', label: 'Required' });
setRule('CS', 'Science and Engineering', { type: 'min_units', units: 36, label: 'At least 36 units', note: 'At least four courses of 9 units or more; at least one with a lab; at least two from the same department' });
setRule('CS', 'Laboratory Requirement', { type: 'pick', n: 1, label: 'Choose 1' });
setRule('CS', 'Humanities and Arts', { type: 'min_units', units: 63, label: 'At least 63 units' });
setRule('CS', 'A. First Year Writing Requirement', { type: 'min_units', units: 9, label: '9 units (1 course or 2 minis)' });
setRule('CS', 'B. Breadth Requirement', { type: 'take_all', units: 27, label: 'One from each category' });
setRule('CS', 'Category 1: Cognition, Choice and Behavior', { type: 'pick', n: 1, units: 9, label: 'Choose 1 (at least 9 units)' });
setRule('CS', 'Category 2: Economic, Political and Social Institutions', { type: 'pick', n: 1, units: 9, label: 'Choose 1 (at least 9 units)' });
setRule('CS', 'Category 3: Cultural Analysis', { type: 'pick', n: 1, units: 9, label: 'Choose 1 (at least 9 units)' });
setRule('CS', 'C. Humanities and Arts Electives', { type: 'min_units', n: 3, units: 27, label: '3 courses (at least 27 units)' });

// IS: Information Systems, B.S. and Dietrich College General Education
setRule('IS', 'Technical Core (Prerequisites)', { type: 'take_all', label: 'Complete all by Fall of third year' });
setRule('IS', 'Mathematics', { type: 'pick', n: 1, label: 'Choose 1' });
setRule('IS', 'Computer Science', { type: 'pick', n: 3, label: 'Three courses required' });
setRule('IS', 'Information Systems Core', { type: 'take_all', label: 'Complete all' });
setRule('IS', 'HCI Requirement', { type: 'pick', n: 1, label: 'Choose 1' });
setRule('IS', 'Information Systems Breadth', { type: 'take_all', label: 'One course from each category' });
setRule('IS', 'Professional Communications', { type: 'pick', n: 1, label: 'Choose 1' });
setRule('IS', 'Quantitative Analysis and Research Methods', { type: 'pick', n: 1, label: 'Choose 1' });
setRule('IS', 'Innovation and Entrepreneurship', { type: 'pick', n: 1, label: 'Choose 1 (after 67-272)' });
setRule('IS', 'Information systems concentration', { type: 'pick', n: 1, label: 'One concentration, approved minor or additional major' });
setRule('IS', 'IS Concentrations', { type: 'pick', n: 1, label: 'Choose 1' });
setRule('IS', 'Data Science', { type: 'min_units', units: 36, label: 'At least 36 units' });
setRule('IS', 'Information Security & Privacy', { type: 'min_units', units: 36, label: 'At least 36 units' });
// New 2026-27 CMU-Q concentration; the catalog lists no courses yet (an admin adds them).
setRule('IS', 'Emerging Technology Management', { type: 'min_units', units: 36, label: 'At least 36 units' });
setRule('IS', 'Digitalization', { type: 'min_units', units: 36, label: 'At least 36 units' });
setRule('IS', 'Data Science Technical Core', { type: 'pick', n: 1, label: 'Choose 1 or more' });
setRule('IS', 'Data Science Applications', { type: 'pick', n: 1, label: 'Choose 1 or more' });
setRule('IS', 'Technical Core', { type: 'pick', n: 1, label: 'Choose 1 or more' });
setRule('IS', 'Regulatory and Behavioral Core', { type: 'pick', n: 1, label: 'Choose 1 or more' });
setRule('IS', 'Enabling Methods, Techniques and Tools', { type: 'pick', n: 1, label: 'Choose 1 or more' });
setRule('IS', 'Orthogonal Topics', { type: 'pick', n: 1, label: 'Choose 1 or more' });
setRule('IS', 'Summative Course', { type: 'required', label: 'Required' });
setRule('IS', 'Approved minors', { type: 'pick', n: 1, label: 'Choose 1' });
setRule('IS', 'Business Administration', { type: 'take_all', label: 'Counts only if these conditions are met' });
setRule('IS', 'Required Courses', { type: 'take_all', label: 'Complete all' });
setRule('IS', 'Constrained Electives', { type: 'pick', n: 1, label: 'Choose 1' });
setRule('IS', 'Electives', { type: 'pick', n: 2, label: 'Choose 2' });
setRule('IS', 'Core@CMU', { type: 'required', label: 'Required in the first year' });
setRule('IS', 'Foundations', { type: 'min_units', units: 54, label: '54 units total' });
setRule('IS', 'Communication', { type: 'min_units', units: 9, label: '9 units (Year 1)' });
setRule('IS', 'Mini Courses', { type: 'pick', n: 2, label: 'Choose 2 mini courses' });
setRule('IS', 'Data Analysis', { type: 'required', label: '36-200 (Year 1)' });
setRule('IS', 'Computational Thinking', { type: 'min_units', units: 9, label: '9 units' });
setRule('IS', 'Contextual Thinking', { type: 'min_units', units: 9, label: '9 units' });
setRule('IS', 'Intercultural and Global Inquiry', { type: 'min_units', units: 9, label: '9 units' });
setRule('IS', 'Scientific Inquiry', { type: 'min_units', units: 9, label: '9 units' });
setRule('IS', 'Disciplinary Perspectives', { type: 'min_units', units: 42, label: '42 units total' });
setRule('IS', 'Humanities', { type: 'min_units', units: 9, label: '9 units' });
setRule('IS', 'Social Sciences', { type: 'min_units', units: 9, label: '9 units' });
setRule('IS', 'The Arts', { type: 'min_units', units: 9, label: '9 units' });
setRule('IS', 'Logic/Mathematical Reasoning', { type: 'min_units', units: 9, label: '9 units' });
setRule('IS', 'Additional Disciplines: Business, Design, or Engineering', { type: 'min_units', units: 6, label: '6 units in one discipline' });
setRule('IS', 'Special Seminars', { type: 'min_units', units: 18, label: '18 units total' });
setRule('IS', 'Grand Challenge Seminar', { type: 'min_units', units: 9, label: '9 units (Year 1)' });
setRule('IS', 'Perspectives on Justice and Injustice', { type: 'min_units', units: 9, label: '9 units' });
setRule('IS', 'Experiential Learning Activity', { type: 'required', label: '1 unit (66-310)' });

// BA: Business Administration, B.S. and the Tepper University Core
setRule('BA', 'Business Foundations', { type: 'take_all', label: 'Complete all' });
setRule('BA', 'Mathematics', { type: 'take_all', n: 3, label: 'Complete all 3' });
setRule('BA', 'Economics', { type: 'take_all', n: 3, label: 'Complete all 3' });
setRule('BA', 'Statistics', { type: 'take_all', n: 2, label: 'Complete both' });
setRule('BA', 'Differential and Integral Calculus', { type: 'pick', n: 1, label: 'Choose 1' });
setRule('BA', '21-111 & 21-112', { type: 'take_all', label: 'Take both' });
setRule('BA', 'Multivariate Analysis', { type: 'pick', n: 1, label: 'Choose 1' });
setRule('BA', 'Optimization for Business', { type: 'pick', n: 1, label: 'Choose 1' });
setRule('BA', 'Principles of Microeconomics', { type: 'pick', n: 1, label: 'Choose 1' });
setRule('BA', 'Intermediate Microeconomics', { type: 'pick', n: 1, label: 'Choose 1' });
setRule('BA', 'Probability and Statistics for Business Applications', { type: 'pick', n: 1, label: 'Choose 1' });
setRule('BA', 'Regression Analysis', { type: 'pick', n: 1, label: 'Choose 1' });
setRule('BA', 'Management Game', { type: 'pick', n: 1, label: 'Choose 1' });
setRule('BA', 'Business Core', { type: 'take_all', label: 'Complete all' });
setRule('BA', 'Concentration', { type: 'pick', n: 1, label: 'Choose 1 concentration' });
setRule('BA', 'Accounting', { type: 'min_units', units: 36, label: 'At least 36 units (not offered at CMU-Q)' });
setRule('BA', 'AI and Business', { type: 'min_units', units: 36, label: 'At least 36 units' });
setRule('BA', 'Business Analytics and Technologies', { type: 'min_units', units: 36, label: 'At least 36 units' });
setRule('BA', 'Entrepreneurship', { type: 'min_units', units: 36, label: 'At least 36 units' });
setRule('BA', 'Finance', { type: 'min_units', units: 36, label: 'At least 36 units' });
setRule('BA', 'Global Economics and Business', { type: 'min_units', units: 36, label: 'At least 36 units' });
setRule('BA', 'Islamic Business Management (CMU-Q)', { type: 'min_units', units: 36, label: 'At least 36 units (CMU-Q only)' });
setRule('BA', 'Marketing Management', { type: 'min_units', units: 36, label: 'At least 36 units' });
setRule('BA', 'Operations Management', { type: 'min_units', units: 36, label: 'At least 36 units (needs a semester in Pittsburgh)' });
setRule('BA', 'Product Management', { type: 'min_units', units: 36, label: 'At least 36 units (needs a semester in Pittsburgh)' });
setRule('BA', 'Strategic Management', { type: 'min_units', units: 36, label: 'At least 36 units' });
setRule('BA', 'Required', { type: 'take_all', label: 'Complete all' });
setRule('BA', 'Required, choose 1 from', { type: 'pick', n: 1, label: 'Choose 1' });
setRule('BA', 'Choose 1 course from', { type: 'pick', n: 1, label: 'Choose 1' });
setRule('BA', 'Choose 1 course (list 1)', { type: 'pick', n: 1, label: 'Choose 1' });
setRule('BA', 'Choose 1 course (list 2)', { type: 'pick', n: 1, label: 'Choose 1' });
setRule('BA', 'Choose 1 course (list 3)', { type: 'pick', n: 1, label: 'Choose 1' });
setRule('BA', 'Choose 1 course from (list 1)', { type: 'pick', n: 1, label: 'Choose 1' });
setRule('BA', 'Choose 1 course from (list 2)', { type: 'pick', n: 1, label: 'Choose 1' });
setRule('BA', 'Choose 2 remaining courses from', { type: 'pick', n: 2, label: 'Choose 2' });
setRule('BA', 'Choose 3 remaining courses from', { type: 'pick', n: 3, label: 'Choose 3' });
setRule('BA', '70-492 or 70-495', { type: 'pick', n: 1, label: 'Only 1 of these counts' });
setRule('BA', 'Business Electives', { type: 'min_units', units: 18, label: 'At least 18 units' });
setRule('BA', 'Core @ Carnegie Mellon', { type: 'required', label: 'Required in the first year' });
setRule('BA', 'University Core', { type: 'take_all', label: 'Complete all, plus 18 units of free electives' });
setRule('BA', 'CMU First Year Writing', { type: 'pick', n: 1, units: 9, label: 'Choose 1 option (9 units)' });
setRule('BA', 'Semester Long Writing Course', { type: 'pick', n: 1, label: 'Choose 1' });
setRule('BA', 'Select 2 Mini Writing Courses', { type: 'pick', n: 2, label: 'Choose 2' });
setRule('BA', 'Scientific Reasoning', { type: 'min_units', units: 9, label: 'At least 9 units' });
setRule('BA', 'Information Literacy', { type: 'min_units', units: 9, label: 'At least 9 units' });
setRule('BA', 'Global, Cultural, and Diverse Perspectives', { type: 'min_units', n: 2, units: 18, label: 'At least 18 units (2 or more courses)' });
setRule('BA', 'Free Electives', { type: 'min_units', units: 18, label: 'At least 18 units' });

// BS: Biological Sciences, B.S. and MCS General Education
setRule('BS', 'Biological Sciences', { type: 'take_all', label: 'Take all (131 units)' });
setRule('BS', 'Modern Biology', { type: 'pick', n: 1, label: 'Choose 1' });
setRule('BS', 'Undergraduate Colloquium for Sophomores', { type: 'required', label: 'Required' });
setRule('BS', 'Honors Biochemistry', { type: 'required', label: 'Required' });
setRule('BS', 'Cell Biology', { type: 'required', label: 'Required (03-240 is the new number)' });
setRule('BS', 'Introduction to Computational Biology', { type: 'required', label: 'Required' });
setRule('BS', 'Genetics', { type: 'pick', n: 1, label: 'Choose 1 (03-330 is the new number of 03-220)' });
setRule('BS', 'Experimental Techniques in Molecular Biology', { type: 'required', label: 'Required' });
setRule('BS', 'Experimental Biochemistry', { type: 'pick', n: 1, label: 'Choose 1' });
setRule('BS', 'Topics in Research', { type: 'take_all', label: 'Take both' });
setRule('BS', 'Biological Sciences Electives', { type: 'min_units', units: 54, label: 'At least 54 units (18 or more at 03-3xx or above)' });
setRule('BS', 'Departmental Electives Group', { type: 'pick', label: 'Any; research counts up to 18 units' });
setRule('BS', 'Interdisciplinary Electives Group', { type: 'max_courses', n: 3, label: 'Up to 3 courses count' });
setRule('BS', 'Mathematics, Physics and Computer Science', { type: 'take_all', label: 'Take all (53 units)' });
setRule('BS', 'Programming for Scientists', { type: 'pick', n: 1, label: 'Choose 1' });
setRule('BS', 'Differential and Integral Calculus', { type: 'required', label: 'Required' });
setRule('BS', 'Integration and Approximation', { type: 'required', label: 'Required' });
setRule('BS', 'Physics I for Science Students', { type: 'pick', n: 1, label: 'Choose 1' });
setRule('BS', 'Physics II for Biological Sciences and Chemistry Students', { type: 'pick', n: 1, label: 'Choose 1' });
setRule('BS', 'Core@CMU', { type: 'required', label: 'Required' });
setRule('BS', 'Chemistry', { type: 'take_all', label: 'Take all (56 units)' });
setRule('BS', 'Introduction to Modern Chemistry I', { type: 'pick', n: 1, label: 'Choose 1' });
setRule('BS', 'Modern Chemistry II', { type: 'required', label: 'Required unless an A in 09-107' });
setRule('BS', 'Organic Chemistry I', { type: 'required', label: 'Required' });
setRule('BS', 'Organic Chemistry II', { type: 'required', label: 'Required' });
setRule('BS', 'Techniques in Quantitative Analysis', { type: 'required', label: 'Required' });
setRule('BS', 'Techniques for Organic Synthesis and Analysis', { type: 'required', label: 'Required' });
setRule('BS', 'Core Areas of Study', { type: 'optional', label: 'Optional; up to two tracks' });
setRule('BS', 'Biochemistry Track', { type: 'pick', n: 5, label: '5 courses (Pittsburgh campus only)' });
setRule('BS', 'Biomedical Sciences Track', { type: 'pick', n: 5, label: '5 courses' });
setRule('BS', 'Cell and Developmental Biology Track', { type: 'pick', n: 5, label: '5 courses' });
setRule('BS', 'Genetics and Molecular Biology Track', { type: 'pick', n: 5, label: '5 courses' });
setRule('BS', 'Neuroscience Track', { type: 'pick', n: 5, label: '5 courses' });
setRule('BS', 'TWO (2) required biology electives', { type: 'take_all', label: 'Take both' });
setRule('BS', 'THREE (3) required biology electives', { type: 'take_all', label: 'Take all 3 (in Qatar, 03-362 may replace 03-741)' });
setRule('BS', 'And any THREE (3) of the following', { type: 'pick', n: 3, label: 'Choose 3 (no more than 9 units at the 100 level)' });
setRule('BS', 'And any TWO (2) of the following', { type: 'pick', n: 2, label: 'Choose 2' });
setRule('BS', 'At least TWO (2) of the following courses', { type: 'pick', n: 2, label: 'Choose at least 2' });
setRule('BS', 'At least TWO (2) of the following', { type: 'pick', n: 2, label: 'Choose at least 2' });
setRule('BS', 'And any TWO (2) or THREE (3) of the following for a total of FIVE (5) courses', { type: 'pick', n: 2, label: 'Choose 2 or 3 (no more than 9 units at the 100 level)' });
setRule('BS', 'And TWO (2) or THREE (3) of the following for a total of FIVE (5) courses', { type: 'pick', n: 2, label: 'Choose 2 or 3 (no more than 9 units at the 100 level)' });
setRule('BS', 'A maximum of one elective can be (with advisor approval)', { type: 'max_courses', n: 1, label: 'Up to 1, with advisor approval' });
setRule('BS', 'A maximum of one elective can be', { type: 'max_courses', n: 1, label: 'Up to 1' });
setRule('BS', 'Options', { type: 'optional', label: 'Optional' });
setRule('BS', 'Technical Breadth Requirements', { type: 'take_all', label: "4 courses; met by this degree's required courses" });
setRule('BS', 'A. Life Sciences', { type: 'min_units', units: 9, label: 'At least 9 units, not 03-xxx (02-250 for this degree)' });
setRule('BS', 'B. Physical Sciences', { type: 'min_units', units: 9, label: 'At least 9 units (09-105, 09-106, 33-121, 33-122 for this degree)' });
setRule('BS', 'C. Mathematics, Statistics, and Computer Science', { type: 'min_units', units: 9, label: 'At least 9 units (21-120 and 21-122 for this degree)' });
setRule('BS', 'D. STEM Course', { type: 'pick', n: 1, label: '1 course: any above, an intro CIT engineering course, or advisor approved' });
setRule('BS', 'Nontechnical Breadth Requirements', { type: 'take_all', label: 'All of A to E' });
setRule('BS', 'A. First-Year Courses', { type: 'take_all', label: 'Take all in the first year' });
setRule('BS', 'First-Year Seminar', { type: 'pick', n: 1, label: 'Choose 1' });
setRule('BS', 'First-Year Writing', { type: 'min_units', units: 9, label: 'At least 9 units' });
setRule('BS', 'B. Science and Society Course', { type: 'pick', n: 1, label: 'Choose 1 (38-304 or a pre-approved elective)' });
setRule('BS', 'C. ENGAGE Courses', { type: 'take_all', label: 'Take all (38-402 may replace 38-330 and 38-430)' });
setRule('BS', 'D. Cultural/Global Understanding Course', { type: 'min_units', units: 9, label: 'At least 9 units' });
setRule('BS', 'E. Nontechnical Elective Courses', { type: 'min_units', units: 36, label: 'At least 4 courses and 36 units' });

// AI: Artificial Intelligence, B.S. and SCS General Education
setRule('AI', 'Math and Statistics', { type: 'take_all', label: 'Take all' });
setRule('AI', 'Mathematical Foundations for Computer Science', { type: 'pick', n: 1, label: 'Choose 1' });
setRule('AI', 'Calculus in Three Dimensions', { type: 'pick', n: 1, label: 'Choose 1' });
setRule('AI', 'Probability and Statistics', { type: 'pick', n: 1, label: 'Choose 1' });
setRule('AI', '21-325 & 36-226', { type: 'take_all', label: 'Take both' });
setRule('AI', '21-425 & 36-226', { type: 'take_all', label: 'Take both' });
setRule('AI', '36-225 & 36-226', { type: 'take_all', label: 'Take both' });
setRule('AI', '36-235 & 36-236', { type: 'take_all', label: 'Take both' });
setRule('AI', 'plus Modern Regression', { type: 'required', label: 'Required' });
setRule('AI', 'Computer Science', { type: 'take_all', label: 'Take all' });
setRule('AI', 'Artificial Intelligence', { type: 'take_all', label: 'Complete all' });
setRule('AI', 'All of the following AI core courses', { type: 'take_all', label: 'Take all' });
setRule('AI', 'plus one of the following AI core courses', { type: 'pick', n: 1, label: 'Choose 1' });
setRule('AI', 'One Decision Making and Robotics course', { type: 'pick', n: 1, units: 9, label: 'Choose 1 (at least 9 units)' });
setRule('AI', 'One Machine Learning course from the following', { type: 'pick', n: 1, units: 9, label: 'Choose 1 (at least 9 units)' });
setRule('AI', 'One Perception and Language course from the following', { type: 'pick', n: 1, units: 9, label: 'Choose 1 (at least 9 units)' });
setRule('AI', 'One Human-AI Interaction course from the following', { type: 'pick', n: 1, units: 12, label: 'Choose 1 (at least 12 units)' });
setRule('AI', 'School of Computer Science Electives', { type: 'pick', n: 2, units: 18, label: 'Choose 2 (at least 9 units each)' });
setRule('AI', 'Ethics Course', { type: 'pick', n: 1, label: 'Choose 1' });
setRule('AI', 'SCS First year seminar', { type: 'required', label: 'Required' });
setRule('AI', 'Core@CMU', { type: 'required', label: 'Required' });
setRule('AI', 'Science and Engineering', { type: 'min_units', units: 36, label: 'At least 36 units', note: 'At least four courses of 9 units or more; at least one with a lab; at least two from the same department' });
setRule('AI', 'Laboratory Requirement', { type: 'pick', n: 1, label: 'Choose 1' });
setRule('AI', 'Humanities and Arts', { type: 'min_units', units: 63, label: 'At least 63 units' });
setRule('AI', 'A. First Year Writing Requirement', { type: 'min_units', units: 9, label: '9 units (1 course or 2 minis)' });
setRule('AI', 'B. Breadth Requirement', { type: 'take_all', units: 27, label: 'One from each category' });
// Category 1A replaces Category 1 for AI majors and comes first, as on the SCS page.
setRule('AI', 'Category 1A: Cognitive Studies', { type: 'pick', n: 1, units: 9, label: 'Choose 1 (at least 9 units)' });
setRule('AI', 'Category 2: Economic, Political and Social Institutions', { type: 'pick', n: 1, units: 9, label: 'Choose 1 (at least 9 units)' });
setRule('AI', 'Category 3: Cultural Analysis', { type: 'pick', n: 1, units: 9, label: 'Choose 1 (at least 9 units)' });
setRule('AI', 'C. Humanities and Arts Electives', { type: 'min_units', n: 3, units: 27, label: '3 courses (at least 27 units)' });

// ── Rows the app keeps but never lists ───────────────────────
// qatar_only is set by backend/scraper/apply_mapping_overlays.py from
// backend/data/mapping_overlays.json: such a course is shown only while its
// SOC offerings include the Qatar campus.
function courseOfferedInQatar(course) {
  return getCourseOfferings(course).some(o => o && o.campus === 'Qatar' && !o.cancelled);
}

function isCourseHidden(course) {
  if (!course) return true;
  return !!course.qatar_only && !courseOfferedInQatar(course);
}

// ── Build requirement tree from courses ──────────────────────
function buildRequirementTree(courses, majorCode) {
  const root = { label: MAJOR_META[majorCode].degree, children: {}, courses: [], path: '' };

  for (const course of courses) {
    if (isCourseHidden(course)) continue;
    const majorReqs = (course.requirements && course.requirements[majorCode]) || [];
    for (const req of majorReqs) {
      const parts = req.requirement.split('---');
      let node = root;
      let pathSoFar = '';
      
      for (let i = 0; i < parts.length; i++) {
        const segment = parts[i];
        pathSoFar = pathSoFar ? pathSoFar + '---' + segment : segment;
        
        if (!node.children[segment]) {
          node.children[segment] = {
            label: LABEL_OVERRIDES[segment] || segment,
            rawLabel: segment,
            children: {},
            courses: [],
            path: pathSoFar,
            depth: i + 1,
            isGenEd: false,
          };
        }
        node = node.children[segment];
      }
      
      // Add course to the leaf node
      node.courses.push({
        code: course.course_code,
        name: course.course_name,
        units: course.units,
        department: course.department,
        offered_qatar: course.offered_qatar,
        offered_pitts: course.offered_pitts,
        type: req.type, // true = gened, false = core
        prerequisites: course.prerequisites,
        offered: course.offered || [],
      });
      node.isGenEd = req.type;
    }
  }
  
  return root;
}

// ── Convert tree children object to sorted array ────────────
function normalizeTree(node, majorCode, depth) {
  const childArray = [];
  for (const [key, child] of Object.entries(node.children)) {
    normalizeTree(child, majorCode, depth + 1);
    
    // Count total courses recursively
    child.totalCourses = countTreeCourses(child);
    
    // Attach fulfillment rule
    child.rule = findRule(majorCode, child.rawLabel, child.path);
    
    childArray.push(child);
  }
  // Catalog order: sibling buckets follow the order of the major's rules.
  // Array sort is stable, so buckets without a rule keep their first-seen order.
  childArray.sort((a, b) => ruleOrder(majorCode, a.rawLabel) - ruleOrder(majorCode, b.rawLabel));
  node.children = childArray;
  return node;
}

/** Position of a bucket name in the major's rules (catalog order); unknown names go last. */
function ruleOrder(majorCode, rawLabel) {
  const keys = Object.keys(FULFILLMENT_RULES[majorCode] || {});
  const i = keys.indexOf(rawLabel);
  return i < 0 ? keys.length : i;
}

function countTreeCourses(node) {
  let count = node.courses.length;
  for (const child of (Array.isArray(node.children) ? node.children : Object.values(node.children))) {
    count += countTreeCourses(child);
  }
  return count;
}

function findRule(majorCode, rawLabel, fullPath) {
  const majorRules = FULFILLMENT_RULES[majorCode];
  if (!majorRules) return null;
  
  // Try exact match on raw label
  if (majorRules[rawLabel]) return majorRules[rawLabel];
  
  // Try matching on last segment of path
  const parts = fullPath.split('---');
  for (let i = parts.length - 1; i >= 0; i--) {
    if (majorRules[parts[i]]) return majorRules[parts[i]];
  }
  
  return null;
}

// ── Separate degree requirements from GenEd ─────────────────
// Every major keeps its general education under the "GenEd" root.
function splitTreeSections(tree, majorCode) {
  const degree = [];
  const gened = [];

  for (const child of tree.children) {
    if (child.rawLabel === 'GenEd') {
      gened.push(child);
    } else {
      degree.push(child);
    }
  }

  return { degree, gened };
}

// ── Canonical course code (82101, 82101.0, 82-101 → 82-101) ─
function normalizeCourseCode(code) {
  if (code == null || code === '') return '';
  let s = String(code).trim();
  if (/^\d+\.0$/.test(s)) s = s.slice(0, -2);
  const digits = s.replace(/-/g, '');
  if (/^\d{5}$/.test(digits)) return digits.slice(0, 2) + '-' + digits.slice(2);
  return s;
}

// ── Admin course edits ──────────────────────────────────────
// The scrape regenerates courses.json daily, so admin edits live in the
// backend and are applied here, after load and before indexing.
const COURSE_EDIT_FIELDS = ['course_name', 'department', 'units', 'description', 'prerequisites', 'offered_qatar', 'offered_pitts', 'offered'];

// What a course counts for is edited per program and per minor, as a change to
// the catalog (README 12.2): { CS: { add: [rows], remove: [paths] },
// 'MINOR:psychology': { add: [category paths], remove: [category paths] } }.
// A key that is absent follows the catalog, so the daily updates keep flowing
// in. A list value is the whole-list shape saved before 2026-11-10: it still
// replaces its own program's rows, and nothing else.
const MINOR_EDIT_PREFIX = 'MINOR:';

// The root of each program's degree paths. Gen Ed paths start with GenEd in
// every program, and the root alone decides a row's Gen Ed flag.
const DEGREE_ROOTS = {
  CS: 'BS in Computer Science',
  IS: 'BS in Information Systems',
  BA: 'BS in Business Administration',
  BS: 'BS in Biological Sciences',
  AI: 'BS in Artificial Intelligence',
  GS: 'BS in General Studies',
};

function _emptyRequirements() {
  const out = {};
  for (const m of MAJOR_ORDER) out[m] = [];
  return out;
}

/** True when a path is GenEd or the program's degree root, then at least one more part. */
function requirementPathRootOk(prog, path) {
  const parts = String(path || '').split('---');
  return parts.length >= 2 && parts.every(Boolean) && (parts[0] === 'GenEd' || parts[0] === DEGREE_ROOTS[prog]);
}

/** An edit row as stored: its path, the Gen Ed flag of its root, its program. Old flags are dropped. */
function _editRow(r, prog) {
  const requirement = typeof r === 'string' ? r : (r && r.requirement);
  if (!requirement) return null;
  return { requirement, type: String(requirement).split('---')[0] === 'GenEd', major: prog || (r && r.major) || '' };
}

/**
 * One program's rows after an admin edit. A legacy list replaces them (any old
 * "earlier" flags on it are ignored); { add, remove } drops the removed paths,
 * then adds the rows the base does not list yet; no edit gives a copy of the base.
 */
function applyProgramEdit(baseRows, edit, prog) {
  if (Array.isArray(edit)) {
    const out = [];
    for (const r of edit) {
      const row = _editRow(r, prog);
      if (row && !out.some(x => x.requirement === row.requirement)) out.push(row);
    }
    return out;
  }
  const rows = (baseRows || []).map(r => Object.assign({}, r));
  if (!edit || typeof edit !== 'object') return rows;
  const remove = new Set(edit.remove || []);
  const out = rows.filter(r => !remove.has(r.requirement));
  for (const r of edit.add || []) {
    const row = _editRow(r, prog);
    if (row && !out.some(x => x.requirement === row.requirement)) out.push(row);
  }
  return out;
}

/** The smallest { add, remove } that turns baseRows into draftRows (by path), or null when they list the same paths. */
function programEditDelta(baseRows, draftRows) {
  const base = new Set((baseRows || []).map(r => r && r.requirement).filter(Boolean));
  const draft = new Set();
  const add = [];
  for (const r of draftRows || []) {
    if (!r || !r.requirement || draft.has(r.requirement)) continue;
    draft.add(r.requirement);
    if (!base.has(r.requirement)) add.push({ requirement: r.requirement, type: String(r.requirement).split('---')[0] === 'GenEd' });
  }
  const remove = [...base].filter(p => !draft.has(p));
  return add.length || remove.length ? { add, remove } : null;
}

/** True when two stored edits of one key say the same thing (a legacy list never matches). */
function sameRequirementEdit(a, b) {
  if (a == null || b == null) return a == null && b == null;
  if (Array.isArray(a) || Array.isArray(b)) return false;
  const paths = list => (list || []).map(x => (typeof x === 'string' ? x : x && x.requirement)).filter(Boolean).sort().join('\n');
  return paths(a.add) === paths(b.add) && paths(a.remove) === paths(b.remove);
}

/**
 * Returns { courses, archived }. Each edited course gets `_edit` (the override)
 * and `_catalog` (the scraped values it replaced) so the admin editor can show both.
 * Program edits change only their own program's rows; minor edits go to
 * `_minorEdits` ({ minor: { add, remove } }) for buildMinorIndex() and never
 * into `requirements`.
 */
function applyCourseOverrides(courses, overrides) {
  if (!overrides || !overrides.length) return { courses, archived: [] };
  // Copy before editing: fetchAllCourses caches the parsed catalog, and a later
  // reload must start from the scraped values, not from edited objects.
  courses = courses.slice();
  const index = new Map(courses.map((c, i) => [normalizeCourseCode(c.course_code), i]));
  const byCode = {
    get(key) {
      const i = index.get(key);
      if (i === undefined) return undefined;
      if (!courses[i]._copied) courses[i] = Object.assign({}, courses[i], { _copied: true, _catalog: {} });
      return courses[i];
    },
    set(key, course) {
      courses.push(course);
      index.set(key, courses.length - 1);
    },
  };
  const archivedCodes = new Set();
  const archived = [];

  for (const o of overrides) {
    const key = normalizeCourseCode(o.course_code);
    const fields = o.fields || {};
    let course = byCode.get(key);
    if (!course && o.is_new) {
      course = {
        course_code: key,
        course_name: '',
        department: '',
        units: 0,
        description: '',
        prerequisites: '',
        offered: [],
        offered_qatar: false,
        offered_pitts: false,
        requirements: _emptyRequirements(),
        soc_sections: [],
        offerings: [],
        _added: true,
        _copied: true,
      };
      byCode.set(key, course);
    }
    if (!course) continue;

    course._catalog = course._catalog || {};
    for (const f of COURSE_EDIT_FIELDS) {
      if (!(f in fields)) continue;
      if (!course._added && !(f in course._catalog)) course._catalog[f] = course[f];
      course[f] = fields[f];
    }
    if (o.requirements && typeof o.requirements === 'object' && Object.keys(o.requirements).length) {
      if (!course._added && !('requirements' in course._catalog)) course._catalog.requirements = course.requirements;
      const next = Object.assign(_emptyRequirements(), course.requirements);
      for (const [key, edit] of Object.entries(o.requirements)) {
        if (key.startsWith(MINOR_EDIT_PREFIX)) {
          if (edit && typeof edit === 'object' && !Array.isArray(edit)) {
            (course._minorEdits || (course._minorEdits = {}))[key.slice(MINOR_EDIT_PREFIX.length)] =
              { add: (edit.add || []).slice(), remove: (edit.remove || []).slice() };
          }
        } else {
          next[key] = applyProgramEdit(next[key], edit, key);
        }
      }
      course.requirements = next;
    }
    if (fields.course_code && fields.course_code !== course.course_code) {
      if (!course._added) course._catalog.course_code = course.course_code;
      course.course_code = fields.course_code;
    }
    course._edit = o;
    if (o.archived) {
      archivedCodes.add(course);
      archived.push(course);
    }
  }
  return { courses: courses.filter(c => !archivedCodes.has(c)), archived };
}

/**
 * Every requirement category per program, with its Gen Ed flag: each bucket of
 * data/requirement_buckets.json when it was loaded (parseRequirementBuckets(),
 * empty buckets included, in catalog order), then the paths of the catalog rows.
 * A heading of the bucket file (a path with buckets under it, such as
 * "BS in Computer Science---Computer Science") is left out unless catalog rows
 * already use it: a course goes in a bucket, not in a heading, and several
 * headings are old bucket names (README 14.10) that must stay flagged.
 * Pass the scraped courses, before admin edits, so an edited path is not a category.
 */
function knownRequirementPaths(courses, buckets) {
  const out = {};
  for (const m of MAJOR_ORDER) out[m] = new Map();
  const used = {};
  for (const c of courses || []) {
    for (const [prog, list] of Object.entries(c.requirements || {})) {
      if (!out[prog]) continue;
      const set = used[prog] || (used[prog] = new Set());
      for (const r of list || []) if (r && r.requirement) set.add(r.requirement);
    }
  }
  for (const [prog, paths] of Object.entries(buckets || {})) {
    if (!out[prog]) continue;
    const all = (paths || []).filter(Boolean);
    for (const p of all) {
      const heading = all.some(q => q !== p && q.startsWith(p + '---'));
      if (heading && !(used[prog] && used[prog].has(p))) continue;
      if (!out[prog].has(p)) out[prog].set(p, String(p).split('---')[0] === 'GenEd');
    }
  }
  for (const c of courses || []) {
    for (const [prog, list] of Object.entries(c.requirements || {})) {
      if (!out[prog]) continue;
      for (const r of list || []) {
        if (r && r.requirement && !out[prog].has(r.requirement)) out[prog].set(r.requirement, !!r.type);
      }
    }
  }
  return out;
}

/**
 * data/requirement_buckets.json, written by the daily pipeline when it exists:
 * every bucket path per program in catalog order, empty buckets included
 * ({ CS: [paths], ... }; a "programs" wrapper and { path } items are accepted
 * too). Returns { program: [paths] }, or null when the data holds no paths.
 */
function parseRequirementBuckets(data) {
  if (!data || typeof data !== 'object') return null;
  const src = data.programs && typeof data.programs === 'object' && !Array.isArray(data.programs) ? data.programs : data;
  const out = {};
  let found = 0;
  for (const prog of Object.keys(MAJOR_META)) {
    const list = src[prog];
    const items = Array.isArray(list) ? list : (list && typeof list === 'object' ? Object.keys(list) : []);
    const paths = [];
    for (const item of items) {
      const p = typeof item === 'string' ? item : (item && (item.path || item.requirement));
      if (typeof p === 'string' && p.includes('---') && !paths.includes(p)) paths.push(p);
    }
    if (paths.length) {
      out[prog] = paths;
      found += paths.length;
    }
  }
  return found ? out : null;
}

// ── Build course index ──────────────────────────────────────
function buildCourseIndex(courses) {
  const index = {};
  for (const course of courses) {
    const canonical = normalizeCourseCode(course.course_code);
    if (canonical && canonical !== course.course_code) {
      course.course_code = canonical;
    }
    if (!canonical) continue;
    index[canonical] = course;
    index[canonical.replace(/-/g, '')] = course;
  }
  return index;
}

function lookupCourse(index, code) {
  if (!code) return null;
  return index[normalizeCourseCode(code)] || index[code] || null;
}

/** Find a requirement node by its --- delimited path. */
function findTreeNode(tree, path) {
  if (!tree || !path) return null;
  const stack = [tree];
  while (stack.length) {
    const node = stack.pop();
    if (node.path === path) return node;
    for (const child of (node.children || [])) stack.push(child);
  }
  return null;
}

/**
 * Collect unique courses mapped to a requirement node (includes descendants).
 * filterFn receives the tree leaf object { code, name, units, ... }.
 */
function collectCoursesForRequirement(node, filterFn) {
  const byCode = new Map();
  function walk(n) {
    for (const c of (n.courses || [])) {
      if (filterFn && !filterFn(c)) continue;
      if (!byCode.has(c.code)) byCode.set(c.code, c);
    }
    for (const child of (n.children || [])) walk(child);
  }
  walk(node);
  return Array.from(byCode.values()).sort((a, b) => a.code.localeCompare(b.code));
}

function formatRequirementPath(path) {
  if (!path) return '';
  return path.split('---').map(p => (LABEL_OVERRIDES[p] || p)).join(' > ');
}

function requirementLeafLabel(requirementPath) {
  const parts = (requirementPath || '').split('---').filter(Boolean);
  if (!parts.length) return '';
  const leaf = parts[parts.length - 1];
  return LABEL_OVERRIDES[leaf] || leaf;
}

// ── Get display-ready mappings for a course ─────────────────
// Shows the leaf category only (e.g. "Intercultural & Global Inquiry").
function getCourseMappings(course) {
  const mappings = {};

  for (const majorCode of MAJOR_ORDER) {
    const reqs = (course.requirements && course.requirements[majorCode]) || [];
    if (reqs.length === 0) continue;

    mappings[majorCode] = reqs.map(req => {
      const parts = req.requirement.split('---');

      return {
        shortLabel: requirementLeafLabel(req.requirement),
        fullPath: req.requirement,
        isGenEd: req.type,
        parts: parts,
      };
    });
  }

  return mappings;
}

// ── Order the "Counts For" columns by role ──────────────────
// Students lead with their own program(s) (their lens); faculty/admins get
// the canonical cross-program order with no personal bias. Pure function.
function orderCfColumns(mappings, profile) {
  const present = MAJOR_ORDER.filter(m => mappings[m] && mappings[m].length);
  if (!profile || (typeof isFaculty === 'function' && isFaculty(profile))) {
    return present;
  }
  const lead = [];
  if (profile.primary && typeof MAJOR_LIST !== 'undefined'
      && MAJOR_LIST.includes(profile.primary) && present.includes(profile.primary)) {
    lead.push(profile.primary);
  }
  const rest = present.filter(m => !lead.includes(m));
  return [...lead, ...rest];
}

// ── Count a faculty member's flags by status ────────────────
// Pure helper for the faculty home "My flags" panel. Unknown statuses are
// ignored so a future status can't crash the summary.
function summarizeFlagsByStatus(items) {
  const counts = { pending: 0, reviewed: 0, resolved: 0, dismissed: 0 };
  for (const f of (items || [])) {
    if (f && Object.prototype.hasOwnProperty.call(counts, f.status)) counts[f.status]++;
  }
  return counts;
}

// ── Get "also counts for" tags for a course in a given major ──
function getAlsoCountsFor(course, currentMajor) {
  const others = [];
  if (isCourseHidden(course)) return others;
  for (const m of MAJOR_ORDER) {
    if (m === currentMajor) continue;
    const reqs = (course.requirements && course.requirements[m]) || [];
    if (reqs.length > 0) {
      others.push(m);
    }
  }
  return others;
}

// ── Offering likelihood (rule-based, no ML) ──────────────────
// Uses the `offered` history on each course (codes like "S22", "F23", "M24",
// "N25") to estimate whether a course is likely to run in a target season.
// Spec § 12: prefer simple, honest signal over fabricated prediction.

const SEASON_NAME = { S: 'Spring', M: 'Summer', N: 'Fall mini', F: 'Fall' };

function _seasonName(code) {
  return SEASON_NAME[code] || code;
}

function predictOffering(course, targetSeason /* 'S' | 'M' | 'N' | 'F' */) {
  if (!course || !targetSeason || !SEASON_NAME[targetSeason]) {
    return { state: 'unknown', reason: 'No prediction available.' };
  }
  const hist = Array.isArray(course.offered) ? course.offered : [];
  // De-duplicate identical entries — some scraping passes wrote dupes.
  const seen = new Set();
  const codes = hist.filter(c => {
    if (!c || seen.has(c)) return false;
    seen.add(c);
    return true;
  });
  if (codes.length < 3) {
    return { state: 'unknown', reason: 'Limited offering history.' };
  }
  const counts = { S: 0, M: 0, N: 0, F: 0 };
  for (const c of codes) if (counts[c[0]] !== undefined) counts[c[0]]++;
  const total = codes.length;
  const share = counts[targetSeason] / total;
  const seasonLabel = _seasonName(targetSeason);
  if (share >= 0.5) {
    return { state: 'likely',   reason: `Typically offered in ${seasonLabel}.` };
  }
  if (counts[targetSeason] === 0) {
    return { state: 'unlikely', reason: `Not offered in ${seasonLabel} in recent years.` };
  }
  if (share < 0.2) {
    return { state: 'rare',     reason: `Rarely offered in ${seasonLabel}.` };
  }
  return { state: 'mixed', reason: `Sometimes offered in ${seasonLabel}.` };
}

// ── Sort semesters chronologically ────────────────────────────
// Within a year: spring, summer, fall (semester_rank in backend/semesters.py
// uses the same order).
const SEASON_ORDER = { S: 1, M: 2, N: 3, F: 4 };

/** A number that grows with time for a semester ("F26" < "S27"); -1 for anything else. */
function semesterRank(code) {
  const c = normalizeSemesterCode(code);
  return c ? Number(c.slice(1)) * 10 + SEASON_ORDER[c[0]] : -1;
}

function sortSemesters(semesters) {
  if (!semesters || !Array.isArray(semesters)) return [];
  return [...new Set(semesters)].sort((a, b) => semesterRank(b) - semesterRank(a)); // newest first
}

// ── Department code to name ──────────────────────────────────
const DEPT_NAMES = {
  '02': 'Computational Biology', '03': 'Biological Sciences', '05': 'HCI',
  '06': 'Biomedical Engineering', '07': 'SCS Interdisciplinary', '08': 'Computational Biology',
  '09': 'Chemistry', '10': 'Machine Learning', '11': 'Language Technologies',
  '12': 'Civil & Environmental Eng', '15': 'Computer Science', '16': 'Robotics',
  '17': 'Software Engineering', '18': 'ECE', '19': 'EPP', '21': 'Mathematics',
  '24': 'Mechanical Engineering', '27': 'BME', '33': 'Physics', '36': 'Statistics',
  '38': 'Biology Collaborative', '42': 'Biomedical Engineering',
  '48': 'Architecture', '49': 'EPP', '51': 'Drama', '57': 'Design',
  '60': 'Music', '62': 'Art', '66': 'EPP', '67': 'Information Systems',
  '69': 'Athletics', '70': 'Business/Tepper', '73': 'Economics',
  '76': 'English', '79': 'History', '80': 'Philosophy',
  '82': 'Modern Languages', '84': 'Political Science', '85': 'Psychology',
  '88': 'Sociology', '95': 'Information Networking', '99': 'CMU-Wide',
};

function getDeptName(courseCode) {
  const prefix = courseCode.replace('-', '').substring(0, 2);
  return DEPT_NAMES[prefix] || `Dept ${prefix}`;
}

// ── Semesters (from the Schedule of Classes) ─────────────────
// No semester list is kept in code. The daily update scrapes every semester
// the Schedule of Classes lists into backend/data/soc.json and
// reconcile_offerings.py copies their sections into each course's
// `offerings`, so the loaded catalog says which semesters exist: a new one
// (Spring 2027, a summer) is in the semester picker the day it is scraped.
const SEMESTER_CODE_RE = /^[FSMN]\d{2}$/;
// The semester picked last, { code, defaultCode }: see resolveSemesterChoice.
const SEMESTER_STORE_KEY = 'cf_semester';

const MODALITY_OPTIONS = [
  { id: 'all', label: 'All' },
  { id: 'in_person', label: 'In Person' },
  { id: 'remote', label: 'Remote' },
  { id: 'hybrid', label: 'Hybrid' },
];

/** True for a semester code: a season letter and two year digits ("S27"). */
function isSemesterCode(code) {
  return typeof code === 'string' && SEMESTER_CODE_RE.test(code);
}

/** "S27", " s27 " or "Spring 2027" → "S27"; anything else → null. */
function normalizeSemesterCode(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const text = raw.trim();
  if (SEMESTER_CODE_RE.test(text.toUpperCase())) return text.toUpperCase();
  const m = text.match(/^([a-z ]+?)\s+20(\d{2})$/i);
  if (!m) return null;
  const season = Object.keys(SEASON_NAME).find(k => SEASON_NAME[k].toLowerCase() === m[1].toLowerCase());
  return season ? season + m[2] : null;
}

/** "S27" → "Spring 2027"; "all" → "All semesters"; anything else as given. */
function semesterLabel(code) {
  if (code === 'all') return 'All semesters';
  const c = normalizeSemesterCode(code);
  return c ? `${SEASON_NAME[c[0]]} 20${c.slice(1)}` : (code || '');
}

/**
 * The semesters the catalog has sections for, newest first (summer
 * included), and the one the app opens on: the newest fall or spring with a
 * section in Qatar, so CMU-Q students see the next regular semester as soon
 * as its Qatar schedule is out. Without a Qatar section it is the newest fall
 * or spring; a summer is the default only in a catalog with no fall or spring.
 * pick_default_semester in backend/semesters.py applies the same rule to
 * soc.json.
 * Returns { codes: ['S27', 'F26', ...], defaultCode: 'S27' } (null when empty).
 */
function catalogSemesters(courses) {
  const found = new Set();
  const inQatar = new Set();
  for (const course of courses || []) {
    for (const o of getCourseOfferings(course)) {
      const code = o && !o.cancelled && normalizeSemesterCode(o.semester_code || o.semesterCode || o.semester);
      if (!code) continue;
      found.add(code);
      if (o.campus === 'Qatar') inQatar.add(code);
    }
  }
  const codes = sortSemesters([...found]);
  const regular = codes.filter(c => c[0] === 'F' || c[0] === 'S');
  return { codes, defaultCode: regular.find(c => inQatar.has(c)) || regular[0] || codes[0] || null };
}

/**
 * Semester picker options: "All semesters", then each code newest first.
 * alwaysInclude (the semester on screen) is listed even if codes lack it.
 */
function semesterOptions(codes, alwaysInclude) {
  const list = Array.isArray(codes) ? codes.slice() : [];
  const extra = normalizeSemesterCode(alwaysInclude);
  if (extra && !list.includes(extra)) list.push(extra);
  return [{ code: 'all', label: semesterLabel('all') }]
    .concat(sortSemesters(list).map(code => ({ code, label: semesterLabel(code) })));
}

/** semesterOptions for the semesters the catalog's offerings have. */
function availableSemesterOptions(courses, alwaysInclude) {
  return semesterOptions(catalogSemesters(courses).codes, alwaysInclude);
}

/**
 * The semester to show once the catalog has loaded. semesters is
 * catalogSemesters(); saved is the stored choice, { code, defaultCode }, where
 * defaultCode was the default when the choice was made. The choice is kept
 * while the catalog has that semester, unless a newer default came out after
 * it (a new semester on the Schedule of Classes): then that new default is
 * shown. "All semesters" is always kept. Without a usable choice: the default,
 * or 'all' for a catalog without sections.
 */
function resolveSemesterChoice(semesters, saved) {
  const { codes = [], defaultCode = null } = semesters || {};
  const choice = saved && typeof saved === 'object' ? saved : { code: saved };
  if (choice.code === 'all') return 'all';
  if (!isSemesterCode(choice.code) || !codes.includes(choice.code)) return defaultCode || 'all';
  if (defaultCode && isSemesterCode(choice.defaultCode)
      && semesterRank(defaultCode) > semesterRank(choice.defaultCode)) {
    return defaultCode;
  }
  return choice.code;
}

function getCourseOfferings(course) {
  if (!course) return [];
  if (Array.isArray(course.offerings) && course.offerings.length) {
    return course.offerings;
  }
  // Legacy soc_sections → normalized offering shape. A section without a
  // semester code is listed under "All semesters" only.
  return (course.soc_sections || []).map(s => ({
    semester: s.semester || semesterLabel(s.semester_code),
    semester_code: s.semester_code || '',
    campus: s.campus || (s.location && s.location.includes('Qatar') ? 'Qatar'
      : s.location && s.location.includes('Pittsburgh') ? 'Pittsburgh' : null),
    section: s.section,
    modality: s.modality || normalizeOfferingModality(s.delivery_mode),
    units: course.units,
    days_times: s.days_times || formatLegacyDaysTimes(s),
    instructor: s.instructor || '',
    location: s.location,
    delivery_mode_raw: s.delivery_mode,
  }));
}

function formatLegacyDaysTimes(s) {
  const days = s.days || 'TBA';
  if (s.begin_time && s.begin_time !== 'TBA' && s.end_time) {
    return `${days} ${s.begin_time}-${s.end_time}`;
  }
  return days;
}

function normalizeOfferingModality(raw) {
  const d = (raw || '').toLowerCase();
  if (!d) return 'In Person';
  if (d.includes('remote only') || d === 'remote') return 'Remote';
  if (d.includes('hybrid') || (d.includes('remote') && d.includes('in-person'))) return 'Hybrid';
  if (d.includes('remote')) return 'Remote';
  return 'In Person';
}

function modalityFilterMatches(offeringModality, filterId) {
  if (!filterId || filterId === 'all') return true;
  const m = (offeringModality || 'In Person').toLowerCase().replace(/\s+/g, '_');
  if (filterId === 'in_person') return m === 'in_person';
  return m === filterId;
}

function campusFilterMatches(offeringCampus, locationFilter) {
  if (!locationFilter || locationFilter === 'all') return true;
  if (locationFilter === 'qatar') return offeringCampus === 'Qatar';
  if (locationFilter === 'pittsburgh') return offeringCampus === 'Pittsburgh';
  return true;
}

function filterOfferings(offerings, { semesterCode, locationFilter, modalityFilter }) {
  return (offerings || []).filter(o => {
    if (semesterCode && semesterCode !== 'all' && o.semester_code !== semesterCode) return false;
    if (!campusFilterMatches(o.campus, locationFilter)) return false;
    if (!modalityFilterMatches(o.modality, modalityFilter)) return false;
    return true;
  });
}

function courseHasMatchingOffering(course, filters) {
  const all = getCourseOfferings(course);
  if (all.length === 0) {
    if (filters.semesterCode && filters.semesterCode !== 'all') {
      const hist = Array.isArray(course.offered) ? course.offered : [];
      if (hist.length && !hist.includes(filters.semesterCode)) return false;
    }
    if (!campusFilterMatches(null, filters.locationFilter)) {
      if (filters.locationFilter === 'qatar') return !!course.offered_qatar;
      if (filters.locationFilter === 'pittsburgh') return !!course.offered_pitts;
    }
    return filters.modalityFilter === 'all' || filters.modalityFilter === 'in_person';
  }
  return filterOfferings(all, filters).length > 0;
}

// ── Schedule planning helpers ────────────────────────────────
const PLAN_DAY_COLUMNS = [
  { code: 'U', label: 'Sun' },
  { code: 'M', label: 'Mon' },
  { code: 'T', label: 'Tue' },
  { code: 'W', label: 'Wed' },
  { code: 'R', label: 'Thu' },
  { code: 'F', label: 'Fri' },
];

const PLAN_CAL_START_MIN = 7 * 60;   // 7:00 AM
const PLAN_CAL_END_MIN = 22 * 60;    // 10:00 PM

function parseTimeToMinutes(hour, minute, meridiem) {
  let h = Number(hour);
  const m = Number(minute);
  const ampm = (meridiem || '').toUpperCase();
  if (ampm === 'PM' && h < 12) h += 12;
  if (ampm === 'AM' && h === 12) h = 0;
  return h * 60 + m;
}

function formatPlanMinutes(totalMin) {
  if (totalMin == null || Number.isNaN(totalMin)) return '';
  let h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  const ampm = h >= 12 ? 'PM' : 'AM';
  if (h > 12) h -= 12;
  if (h === 0) h = 12;
  return `${h}:${String(m).padStart(2, '0')} ${ampm}`;
}

/**
 * Parse CMU-style days_times strings, e.g. "UTR 08:30AM-09:45AM".
 * Day letters: U=Sun, M=Mon, T=Tue, W=Wed, R=Thu, F=Fri.
 */
function parseDaysTimes(raw) {
  const text = (raw || '').trim();
  if (!text || text === 'TBA') {
    return { parseable: false, days: [], startMin: null, endMin: null, raw: text || 'TBA' };
  }
  const full = text.match(/^([UMTWRF]+)\s+(\d{1,2}):(\d{2})\s*(AM|PM)\s*-\s*(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (full) {
    return {
      parseable: true,
      days: full[1].toUpperCase().split(''),
      startMin: parseTimeToMinutes(full[2], full[3], full[4]),
      endMin: parseTimeToMinutes(full[5], full[6], full[7]),
      raw: text,
    };
  }
  const daysOnly = text.match(/^([UMTWRF]+)$/i);
  if (daysOnly) {
    return {
      parseable: false,
      days: daysOnly[1].toUpperCase().split(''),
      startMin: null,
      endMin: null,
      raw: text,
    };
  }
  return { parseable: false, days: [], startMin: null, endMin: null, raw: text };
}

/**
 * Display text for a stored meeting string: "MW 03:30PM-04:50PM" becomes
 * "MW 3:30 PM to 4:50 PM". Only for showing to people; the stored days_times
 * keeps its hyphen because parseDaysTimes and planOfferingKey (saved plan
 * keys) read it. Anything that is not "DAYS hh:mmAM-hh:mmPM" comes back as is.
 */
function formatDaysTimesForDisplay(raw) {
  const text = String(raw == null ? '' : raw).trim();
  if (!text) return 'TBA';
  const m = text.match(/^(?:([A-Za-z]+)\s+)?(\d{1,2}):(\d{2})\s*(AM|PM)\s*-\s*(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) return text;
  const start = formatPlanMinutes(parseTimeToMinutes(m[2], m[3], m[4]));
  const end = formatPlanMinutes(parseTimeToMinutes(m[5], m[6], m[7]));
  return `${m[1] ? m[1] + ' ' : ''}${start} to ${end}`;
}

function planOfferingKey(courseCode, offering) {
  const o = offering || {};
  return [
    courseCode || '',
    o.semester_code || '',
    o.section || '',
    o.campus || '',
    o.days_times || '',
  ].join('::');
}

/** Groups offerings that share section + campus + semester (multi-meeting sections). */
function planSectionKey(courseCode, offering) {
  const o = offering || {};
  return [
    courseCode || '',
    o.semester_code || '',
    o.section || '',
    o.campus || '',
  ].join('::');
}

function offeringDaysTimes(o) {
  if (!o) return 'TBA';
  if (o.days_times && o.days_times !== 'TBA') return o.days_times;
  if (o.begin_time && o.begin_time !== 'TBA' && o.end_time) {
    return `${o.days || 'TBA'} ${o.begin_time}-${o.end_time}`;
  }
  return 'TBA';
}

// ── Offering groups: a lecture with its sections ─────────────
// The Schedule of Classes lists each lecture ("Lec 1") followed by its own
// sections (recitations, labs: "A", "B", ...). A student takes the lecture
// and one of its sections, which usually meet at other times of the week.

/** True for a lecture of the Schedule of Classes: "Lec", "Lec 1", "Lec 12". */
function isLectureSection(section) {
  return /^lec/i.test(String(section == null ? '' : section).trim());
}

/** How the planner names a section: "Lec 2" for a lecture, "Sec W" for the others. */
function planSectionLabel(section) {
  const s = String(section == null ? '' : section).trim();
  return isLectureSection(s) ? s : `Sec ${s}`;
}

/**
 * A course's offerings linked the way the Schedule of Classes lists them.
 * Pass the full offering list in its stored (Schedule of Classes) order,
 * before any filter: within one semester and campus, a section that is not a
 * lecture belongs to the nearest lecture listed before it. A section with no
 * such lecture stands alone, and so does a lecture with no sections. Only the
 * list order counts, never alphabetical order.
 *
 * Returns offering groups in list order, { semester_code, campus, lecture,
 * sections }: lecture (or null) and each entry of sections are section groups,
 * { semester_code, section, campus, modality, meetings }, so a section that
 * meets at several times is one entry with several meetings (its rows).
 */
function linkOfferingGroups(offerings) {
  const groups = [];
  const bySection = new Map();
  const lastLecture = new Map();
  for (const o of offerings || []) {
    if (!o) continue;
    const key = [o.semester_code || '', o.section || '', o.campus || ''].join('::');
    const known = bySection.get(key);
    if (known) {
      known.meetings.push(o);
      continue;
    }
    const part = {
      semester_code: o.semester_code,
      section: o.section,
      campus: o.campus,
      modality: o.modality || o.delivery_mode || '',
      meetings: [o],
    };
    bySection.set(key, part);
    const scope = (o.semester_code || '') + '::' + (o.campus || '');
    if (isLectureSection(o.section)) {
      const group = { semester_code: o.semester_code, campus: o.campus, lecture: part, sections: [] };
      groups.push(group);
      lastLecture.set(scope, group);
    } else if (lastLecture.has(scope)) {
      lastLecture.get(scope).sections.push(part);
    } else {
      groups.push({ semester_code: o.semester_code, campus: o.campus, lecture: null, sections: [part] });
    }
  }
  return groups;
}

/** The section groups of an offering group: its lecture first, then its sections. */
function offeringGroupParts(group) {
  if (!group) return [];
  return (group.lecture ? [group.lecture] : []).concat(group.sections || []);
}

/**
 * The offering groups the semester, campus and modality filters show: a group
 * shows when its semester and campus match and, for the modality filter, when
 * any of its meetings matches. A group that shows keeps all its sections.
 */
function filterOfferingGroups(groups, { semesterCode, locationFilter, modalityFilter }) {
  return (groups || []).filter(g => {
    if (semesterCode && semesterCode !== 'all' && g.semester_code !== semesterCode) return false;
    if (!campusFilterMatches(g.campus, locationFilter)) return false;
    return offeringGroupParts(g).some(p => p.meetings.some(m => modalityFilterMatches(m.modality, modalityFilter)));
  });
}

/** Key of an offering group: the planSectionKey of its lecture, or of its only section. */
function offeringGroupKey(courseCode, group) {
  return planSectionKey(courseCode, offeringGroupParts(group)[0]);
}

/** The offering group that holds a section, as { group, part }, or null. */
function findOfferingGroup(groups, semesterCode, section, campus) {
  for (const group of groups || []) {
    if ((group.semester_code || '') !== (semesterCode || '') || (group.campus || '') !== (campus || '')) continue;
    const part = offeringGroupParts(group).find(p => (p.section || '') === (section || ''));
    if (part) return { group, part };
  }
  return null;
}

/**
 * What planning one section of an offering group means: { parts, others }.
 * parts is the group's lecture (if any) with the chosen section; others are
 * the lecture's other sections, which the choice replaces (a student takes
 * one section per lecture). Choosing the lecture of a group with sections
 * pairs it with the section isPlanned(meeting) finds planned, else the first.
 */
function offeringGroupChoice(group, section, isPlanned) {
  const sections = (group && group.sections) || [];
  const lecture = (group && group.lecture) || null;
  let chosen = sections.find(p => (p.section || '') === (section || '')) || null;
  if (!chosen) {
    if (!lecture || (lecture.section || '') !== (section || '')) return { parts: [], others: [] };
    chosen = (isPlanned && sections.find(p => p.meetings.some(isPlanned))) || sections[0] || null;
  }
  return {
    parts: (lecture ? [lecture] : []).concat(chosen ? [chosen] : []),
    others: sections.filter(p => p !== chosen),
  };
}

/**
 * The offering group a planned meeting belongs to: { key, group, part }.
 * A meeting whose section the catalog no longer lists keeps its own section
 * key (group and part are null).
 */
function planItemOfferingGroup(item, groups) {
  const found = findOfferingGroup(groups, item.semester_code, item.section, item.campus);
  if (found) return { key: offeringGroupKey(item.course_code, found.group), group: found.group, part: found.part };
  return { key: planSectionKey(item.course_code, item), group: null, part: null };
}

/**
 * planItemOfferingGroup() for planned meetings of any course: returns a
 * function item => { key, group, part }. groupsFor(code) returns a course's
 * linkOfferingGroups(); each course is linked once.
 */
function planItemOfferingGroups(groupsFor) {
  const groupsByCourse = new Map();
  return item => {
    if (!groupsByCourse.has(item.course_code)) groupsByCourse.set(item.course_code, groupsFor(item.course_code) || []);
    return planItemOfferingGroup(item, groupsByCourse.get(item.course_code));
  };
}

/**
 * Planned meetings as one entry per offering group, so a lecture and the
 * section planned with it are one entry ("Lec 2 + Sec W"). groupsFor(code)
 * returns a course's linkOfferingGroups(). Entries keep the plan order:
 * { key, course_code, semester_code, campus, parts, meetings }, where parts
 * ({ section, meetings }) list the lecture first.
 */
function groupPlanItemsByOffering(items, groupsFor) {
  const entries = new Map();
  const offeringOf = planItemOfferingGroups(groupsFor);
  for (const item of items || []) {
    const ref = offeringOf(item);
    let entry = entries.get(ref.key);
    if (!entry) {
      entry = { key: ref.key, course_code: item.course_code, semester_code: item.semester_code, campus: item.campus, parts: [], meetings: [] };
      entries.set(ref.key, entry);
    }
    entry.meetings.push(item);
    let part = entry.parts.find(p => p.section === item.section);
    if (!part) {
      const rank = ref.group ? offeringGroupParts(ref.group).indexOf(ref.part) : (isLectureSection(item.section) ? 0 : 1);
      part = { section: item.section, rank, meetings: [] };
      entry.parts.push(part);
    }
    part.meetings.push(item);
  }
  const out = Array.from(entries.values());
  for (const entry of out) entry.parts.sort((a, b) => a.rank - b.rank);
  return out;
}

function planEntriesOverlap(a, b) {
  if (!a || !b) return false;
  if (a.semester_code !== b.semester_code) return false;
  const pa = parseDaysTimes(a.days_times);
  const pb = parseDaysTimes(b.days_times);
  if (!pa.parseable || !pb.parseable) return false;
  const sharedDays = pa.days.filter(d => pb.days.includes(d));
  if (!sharedDays.length) return false;
  return pa.startMin < pb.endMin && pb.startMin < pa.endMin;
}

/**
 * The pairs of planned meetings that meet at the same time, as [a, b] in plan
 * order. Meetings of one offering never conflict with each other: a student
 * takes a lecture with its section, and the Schedule of Classes itself lists
 * some lectures inside their lab's time (03-117 Lec 1 TR 1:00 PM to 1:50 PM,
 * lab A TR 1:00 PM to 4:00 PM) and some sections with overlapping rows of their
 * own (09-207 Pittsburgh A). offeringKeyOf(item) names an item's offering
 * (planItemOfferingGroups()(item).key: same course, semester, campus and
 * lecture); without it, an item's offering is its section (planSectionKey()).
 * Meetings of different courses, or of two offerings of one course, still
 * conflict when their times overlap.
 */
function planConflictPairs(items, offeringKeyOf) {
  const list = items || [];
  const keyOf = offeringKeyOf || (item => planSectionKey(item.course_code, item));
  const keys = list.map(keyOf);
  const pairs = [];
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      if (keys[i] !== keys[j] && planEntriesOverlap(list[i], list[j])) pairs.push([list[i], list[j]]);
    }
  }
  return pairs;
}

/** Ids of the planned meetings that are in a conflict (planConflictPairs()). */
function findPlanConflicts(items, offeringKeyOf) {
  const conflicts = new Set();
  for (const [a, b] of planConflictPairs(items, offeringKeyOf)) {
    conflicts.add(a.id);
    conflicts.add(b.id);
  }
  return conflicts;
}

/** How many pairs of planned meetings conflict (planConflictPairs()). */
function countPlanConflictPairs(items, offeringKeyOf) {
  return planConflictPairs(items, offeringKeyOf).length;
}

function planBlocksTimeOverlap(a, b) {
  const pa = a.parsed || a;
  const pb = b.parsed || b;
  if (!pa || !pb || pa.startMin == null || pb.startMin == null) return false;
  return pa.startMin < pb.endMin && pb.startMin < pa.endMin;
}

/** Side-by-side column layout for overlapping blocks on one calendar day. */
function layoutPlanDayBlocks(entries) {
  if (!entries || !entries.length) return [];

  const sorted = entries.slice().sort(
    (a, b) => a.parsed.startMin - b.parsed.startMin || a.parsed.endMin - b.parsed.endMin
  );

  const parent = sorted.map((_, i) => i);
  function find(i) {
    let root = i;
    while (parent[root] !== root) root = parent[root];
    while (parent[i] !== i) {
      const next = parent[i];
      parent[i] = root;
      i = next;
    }
    return root;
  }
  function unite(a, b) {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  }

  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      if (planBlocksTimeOverlap(sorted[i], sorted[j])) unite(i, j);
    }
  }

  const groups = new Map();
  sorted.forEach((entry, i) => {
    const g = find(i);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(entry);
  });

  const result = [];
  for (const group of groups.values()) {
    const colEnds = [];
    const withCol = group.slice().sort(
      (a, b) => a.parsed.startMin - b.parsed.startMin || a.parsed.endMin - b.parsed.endMin
    ).map(entry => {
      let col = colEnds.findIndex(end => end <= entry.parsed.startMin);
      if (col === -1) {
        col = colEnds.length;
        colEnds.push(0);
      }
      colEnds[col] = entry.parsed.endMin;
      return { ...entry, col };
    });
    const totalCols = Math.max(colEnds.length, 1);
    withCol.forEach(entry => result.push({ ...entry, totalCols }));
  }

  return result;
}

// ── Minors (frontend/data/minors.json) ───────────────────────
// minors.json describes each minor as a tree of categories; the catalog
// supplies the course facts (names, units, offerings). Everything in this
// section is pure (no DOM, no storage) and is tested in tests/minors.test.js.
//
// A category lists its courses by code (`courses`), matches them by number
// (`select`) or holds sub categories (`children`). Its `rule` is one of
// take_all, required, pick (n courses, or n parts when count is "children",
// or n courses across its parts when count is "courses"; `units` adds a unit
// floor), min_units or max_units.

/** "15-122" gives { prefix: "15", number: 122 }; anything else gives null. */
function parseCourseNumber(code) {
  const m = /^(\d{2})-(\d{3})$/.exec(normalizeCourseCode(code));
  return m ? { prefix: m[1], number: Number(m[2]) } : null;
}

/**
 * True when a catalog course meets a category's select rule: one of the
 * prefixes, a number inside [min_number, max_number], not excluded by code or
 * by an excluded range, and at least min_units_per_course units when set.
 */
function courseMatchesSelect(course, select) {
  if (!course || !select) return false;
  const code = normalizeCourseCode(course.course_code);
  const num = parseCourseNumber(code);
  if (!num) return false;
  if (!(select.prefixes || []).includes(num.prefix)) return false;
  const lo = select.min_number == null ? 0 : select.min_number;
  const hi = select.max_number == null ? 999 : select.max_number;
  if (num.number < lo || num.number > hi) return false;
  if ((select.exclude || []).some(x => normalizeCourseCode(x) === code)) return false;
  for (const r of (select.exclude_ranges || [])) {
    if (!r || r.prefix !== num.prefix) continue;
    const rlo = r.min_number == null ? 0 : r.min_number;
    const rhi = r.max_number == null ? 999 : r.max_number;
    if (num.number >= rlo && num.number <= rhi) return false;
  }
  if (select.min_units_per_course != null && !(Number(course.units) >= select.min_units_per_course)) return false;
  return true;
}

/**
 * The catalog courses of one category: its listed codes that have a catalog
 * row, plus every course its select rule matches, sorted by code. Listed codes
 * with no catalog row come back in `missing`. Hidden rows (isCourseHidden)
 * never count.
 */
function expandMinorCategory(cat, courses, courseIndex) {
  const found = new Map();
  const missing = [];
  for (const raw of (cat && cat.courses) || []) {
    const code = normalizeCourseCode(raw);
    const course = lookupCourse(courseIndex, code);
    if (!course) {
      if (code && !missing.includes(code)) missing.push(code);
      continue;
    }
    if (!isCourseHidden(course)) found.set(normalizeCourseCode(course.course_code), course);
  }
  if (cat && cat.select) {
    for (const course of courses || []) {
      if (isCourseHidden(course) || !courseMatchesSelect(course, cat.select)) continue;
      found.set(normalizeCourseCode(course.course_code), course);
    }
  }
  const list = Array.from(found.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(e => e[1]);
  return { courses: list, missing };
}

/**
 * The rule chip of a category, worded like the major chips of the 2026-27
 * catalog ("Choose 1 (at least 9 units)", "At least 36 units"). A pick's
 * units are a floor for all its courses together.
 */
function minorRuleLabel(rule, childCount) {
  if (!rule) return '';
  const withUnits = text => (rule.units != null ? `${text} (at least ${rule.units} units)` : text);
  switch (rule.type) {
    case 'take_all': return 'Take all';
    case 'required': return 'Required';
    case 'pick':
      if (rule.count === 'children') return `Choose ${rule.n} of ${childCount}`;
      if (rule.count === 'courses') return withUnits(`${rule.n} courses`);
      return withUnits(`Choose ${rule.n}`);
    case 'min_units': return rule.units != null ? `At least ${rule.units} units` : 'Units';
    case 'max_units': return rule.units != null ? `Up to ${rule.units} units` : 'Optional';
    default: return '';
  }
}

function _minorLeafCourse(course) {
  return {
    code: normalizeCourseCode(course.course_code),
    name: course.course_name,
    units: course.units,
    department: course.department,
    offered_qatar: course.offered_qatar,
    offered_pitts: course.offered_pitts,
    type: false,
    prerequisites: course.prerequisites,
    offered: course.offered || [],
  };
}

/** The categories of a minor that hold courses (no sub categories), in file order: [{ path, id, label, pathLabel }]. */
function minorLeafCategories(def) {
  const out = [];
  (function walk(cats, prefix, names) {
    for (const cat of cats || []) {
      if (!cat || !cat.id) continue;
      const path = prefix ? prefix + '---' + cat.id : cat.id;
      const labels = names.concat(cat.name || cat.id);
      if ((cat.children || []).length) walk(cat.children, path, labels);
      else out.push({ path, id: cat.id, label: cat.name || cat.id, pathLabel: labels.join(' › ') });
    }
  })((def && def.categories) || [], '', []);
  return out;
}

/** The leaf categories that accept a course by the minor file alone: they list its code, or their select rule matches it. */
function minorFileCategories(def, course) {
  if (!def || !course) return [];
  const code = normalizeCourseCode(course.course_code);
  const out = [];
  (function walk(cats, prefix) {
    for (const cat of cats || []) {
      if (!cat || !cat.id) continue;
      const path = prefix ? prefix + '---' + cat.id : cat.id;
      if ((cat.children || []).length) {
        walk(cat.children, path);
        continue;
      }
      const listed = (cat.courses || []).some(c => normalizeCourseCode(c) === code);
      if (listed || (cat.select && courseMatchesSelect(course, cat.select))) out.push(path);
    }
  })(def.categories || [], '');
  return out;
}

/** The admin's minor category edits in the catalog: Map(minor, Map(course code, { add: Set, remove: Set })). */
function collectMinorEdits(courses) {
  const out = new Map();
  for (const c of courses || []) {
    if (!c || !c._minorEdits) continue;
    const code = normalizeCourseCode(c.course_code);
    for (const [minor, e] of Object.entries(c._minorEdits)) {
      if (!out.has(minor)) out.set(minor, new Map());
      out.get(minor).set(code, { add: new Set((e && e.add) || []), remove: new Set((e && e.remove) || []) });
    }
  }
  return out;
}

/**
 * A leaf category's courses after the admin edits (edits: Map(code, { add, remove })):
 * removed codes leave, added codes with a catalog row that is not hidden join,
 * sorted by code. Also returns the codes each edit actually changed.
 */
function _applyMinorEdits(expanded, path, edits, courseIndex) {
  const found = new Map(expanded.courses.map(c => [normalizeCourseCode(c.course_code), c]));
  const adminAdded = [];
  const adminRemoved = [];
  for (const [code, e] of edits) {
    if (e.remove.has(path) && found.has(code)) {
      found.delete(code);
      adminRemoved.push(code);
    }
    if (e.add.has(path) && !found.has(code)) {
      const course = lookupCourse(courseIndex, code);
      if (course && !isCourseHidden(course)) {
        found.set(code, course);
        adminAdded.push(code);
      }
    }
  }
  const courses = Array.from(found.entries()).sort((a, b) => a[0].localeCompare(b[0])).map(e => e[1]);
  return { courses, missing: expanded.missing, adminAdded: adminAdded.sort(), adminRemoved: adminRemoved.sort() };
}

/**
 * One minor as a requirement tree with the same node shape as the major trees
 * (label, path, children, courses, rule), so the same tree components render
 * it. Paths are category ids joined by "---"; tree keys are "minor:<code>".
 * `edits` (from collectMinorEdits) adds and removes courses in its categories
 * that hold courses; the codes it changed are on each node as adminAdded and
 * adminRemoved.
 */
function buildMinorTree(minorCode, def, courses, courseIndex, edits) {
  const treeKey = 'minor:' + minorCode;
  function build(cat, parentPath, depth) {
    const path = parentPath ? parentPath + '---' + cat.id : cat.id;
    const children = (cat.children || []).map(ch => build(ch, path, depth + 1));
    const hasList = Array.isArray(cat.courses) && cat.courses.length > 0;
    let expanded = (hasList || cat.select)
      ? expandMinorCategory(cat, courses, courseIndex)
      : { courses: [], missing: [] };
    if (!children.length && edits && edits.size) expanded = _applyMinorEdits(expanded, path, edits, courseIndex);
    const listed = [];
    for (const raw of cat.courses || []) {
      const code = normalizeCourseCode(raw);
      if (code && !listed.includes(code)) listed.push(code);
    }
    const node = {
      label: cat.name,
      rawLabel: cat.name,
      path,
      depth,
      id: cat.id,
      isMinor: true,
      minorCode,
      treeKey,
      rule: Object.assign({}, cat.rule || {}, { label: minorRuleLabel(cat.rule, children.length) }),
      notes: Array.isArray(cat.notes) ? cat.notes.slice() : [],
      listed,
      missing: expanded.missing,
      adminAdded: expanded.adminAdded || [],
      adminRemoved: expanded.adminRemoved || [],
      hasSelect: !!cat.select,
      selectOnly: !!cat.select && !hasList,
      courses: expanded.courses.map(_minorLeafCourse),
      children,
      isGenEd: false,
    };
    node.totalCourses = countTreeCourses(node);
    return node;
  }
  const root = {
    label: ((def && def.name) || minorCode) + ' minor',
    rawLabel: (def && def.name) || minorCode,
    path: '',
    depth: -1,
    isMinor: true,
    minorCode,
    treeKey,
    courses: [],
    children: [],
  };
  root.children = ((def && def.categories) || []).map(cat => build(cat, '', 0));
  root.totalCourses = countTreeCourses(root);
  return root;
}

/**
 * Every minor of minors.json built against the loaded catalog:
 * { order: [codes sorted by name], byCode: { code: { code, key, def, tree, eligible } } }.
 * eligible maps a course code to the paths of the categories that accept it,
 * after the admin's minor category edits (collectMinorEdits()).
 */
function buildMinorIndex(data, courses, courseIndex) {
  const index = { order: [], byCode: {} };
  const minors = (data && data.minors) || {};
  const edits = collectMinorEdits(courses);
  for (const [code, def] of Object.entries(minors)) {
    if (!def || typeof def !== 'object') continue;
    const tree = buildMinorTree(code, def, courses, courseIndex, edits.get(code));
    const eligible = new Map();
    (function walk(node) {
      for (const c of node.courses || []) {
        if (!eligible.has(c.code)) eligible.set(c.code, []);
        eligible.get(c.code).push(node.path);
      }
      for (const ch of node.children || []) walk(ch);
    })(tree);
    index.byCode[code] = { code, key: tree.treeKey, def, tree, eligible };
  }
  index.order = Object.keys(index.byCode).sort((a, b) =>
    String(index.byCode[a].def.name || a).localeCompare(String(index.byCode[b].def.name || b)));
  return index;
}

// ── Admin minor settings ────────────────────────────────────
// /api/minors/overrides corrects a few numbers of minors.json (backend/minor_overrides.py).
const MINOR_SETTING_FIELDS = ['total_units', 'max_with_major', 'max_with_other_minors', 'admin_note'];

/**
 * A copy of the minors data with each admin override applied: total_units and
 * admin_note on the minor, the two limits in double_count (marked `edited`, so
 * they apply on their own). An edited minor gets `_edit` (the override) and
 * `_file` (the file values it replaced). The cached file object is not changed.
 */
function applyMinorOverrides(minorsData, items) {
  if (!minorsData || !minorsData.minors || !Array.isArray(items) || !items.length) return minorsData;
  const minors = Object.assign({}, minorsData.minors);
  for (const o of items) {
    const def = o && minors[o.minor_code];
    const f = (o && o.fields) || {};
    if (!def || typeof def !== 'object' || !MINOR_SETTING_FIELDS.some(k => k in f)) continue;
    const fileDc = def.double_count || {};
    const dc = Object.assign({}, fileDc);
    const next = Object.assign({}, def, { double_count: dc, _edit: o, _file: {} });
    if ('total_units' in f) {
      next._file.total_units = def.total_units;
      next.total_units = f.total_units;
    }
    for (const k of ['max_with_major', 'max_with_other_minors']) {
      if (!(k in f)) continue;
      next._file[k] = fileDc[k] === undefined ? null : fileDc[k];
      dc[k] = f[k];
      dc.edited = true;
    }
    if (dc.edited && !('max_with_other_minors' in f)) dc.max_with_other_minors = fileDc.max_with_other_minors === undefined ? fileDc.max_with_major : fileDc.max_with_other_minors;
    if ('admin_note' in f) next.admin_note = f.admin_note;
    minors[o.minor_code] = next;
  }
  return Object.assign({}, minorsData, { minors });
}

/** True when a course can count for a minor (some category lists or matches it). */
function courseCountsForMinor(course, minorCode, minorIndex) {
  if (!course || !minorCode || !minorIndex || !minorIndex.byCode) return false;
  const m = minorIndex.byCode[minorCode];
  if (!m || isCourseHidden(course)) return false;
  return m.eligible.has(normalizeCourseCode(course.course_code));
}

/**
 * How a course counts for a major: 'degree' when it has a major (core)
 * requirement row, 'gened' when it only has General Education rows, null when
 * it has none (or the row is hidden).
 */
function majorCountKind(course, majorCode) {
  if (!course || !majorCode || isCourseHidden(course)) return null;
  const rows = (course.requirements && course.requirements[majorCode]) || [];
  if (!Array.isArray(rows) || !rows.length) return null;
  return rows.some(r => r && !r.type) ? 'degree' : 'gened';
}

/** "A", "A and B", "A, B and C". */
function joinWithAnd(items) {
  const list = (items || []).filter(Boolean);
  if (list.length <= 1) return list.join('');
  return list.slice(0, -1).join(', ') + ' and ' + list[list.length - 1];
}

/** Name of a category (any depth) of a minor definition, by id. */
function minorCategoryName(def, id) {
  const stack = ((def && def.categories) || []).slice();
  while (stack.length) {
    const cat = stack.shift();
    if (cat && cat.id === id) return cat.name;
    for (const ch of (cat && cat.children) || []) stack.push(ch);
  }
  return null;
}

/**
 * The double counting rules of a minor for one major (by_major overrides the
 * categories). The files state one limit for the major and other minors
 * together (max_with_major, equal to max_with_other_minors in every file).
 * Once an admin sets the limits on the admin page (applyMinorOverrides()
 * marks double_count.edited), max_with_other_minors applies to other minors
 * on its own: `separate` is then true when the two differ.
 */
function minorDoubleCountRules(def, majorCode) {
  const dc = (def && def.double_count) || {};
  const forMajor = (dc.by_major && majorCode && dc.by_major[majorCode]) || {};
  const limit = typeof dc.max_with_major === 'number' ? dc.max_with_major : null;
  const minorLimit = dc.edited
    ? (typeof dc.max_with_other_minors === 'number' ? dc.max_with_other_minors : null)
    : limit;
  return {
    limit,
    minorLimit,
    separate: minorLimit !== limit,
    known: dc.text != null || typeof dc.max_with_major === 'number' || !!dc.edited,
    noLimit: forMajor.no_limit_categories || dc.no_limit_categories || [],
    noSharing: forMajor.no_sharing_categories || dc.no_sharing_categories || [],
  };
}

/**
 * The limit in plain English for a minor header. `whose` is "your" for a
 * student and "a student's" for everyone else.
 */
function minorDoubleCountLimitText(def, majorCode, whose) {
  const who = whose || 'your';
  const rules = minorDoubleCountRules(def, majorCode);
  if (!rules.known) return 'Confirm double counting with your advisor.';
  const names = ids => joinWithAnd(ids.map(id => minorCategoryName(def, id) || id));
  if (rules.separate) {
    const part = (lim, to) => (lim === 0 ? `No course may also count toward ${to}.`
      : lim != null ? `At most ${lim} course${lim === 1 ? '' : 's'} may also count toward ${to}.`
        : `Courses may also count toward ${to} without a limit.`);
    const extra = [];
    if (rules.noLimit.length) extra.push(`Courses used for ${names(rules.noLimit)} do not count toward these limits.`);
    if (rules.noSharing.length) extra.push(`Courses used for ${names(rules.noSharing)} may not count toward any other program.`);
    return [part(rules.limit, `${who} major`), part(rules.minorLimit, 'another minor'), ...extra].join(' ');
  }
  const target = `${who} major or another minor`;
  if (rules.limit === 0) {
    return `No course may also count toward ${target}`
      + (rules.noLimit.length ? `, except courses used for ${names(rules.noLimit)}.` : '.');
  }
  if (rules.limit != null) {
    const extra = [];
    if (rules.noLimit.length) extra.push(`Courses used for ${names(rules.noLimit)} do not count toward this limit.`);
    if (rules.noSharing.length) extra.push(`Courses used for ${names(rules.noSharing)} may not count toward any other program.`);
    return `At most ${rules.limit} course${rules.limit === 1 ? '' : 's'} may also count toward ${target}.`
      + (extra.length ? ' ' + extra.join(' ') : '');
  }
  return `Courses may also count toward ${target} without a limit`
    + (rules.noSharing.length ? `, except courses used for ${names(rules.noSharing)}.` : '.');
}

/**
 * Where a minor's requirements come from: 'catalog' when its source_file is an
 * archived CMU catalog page (.html, Product Management), 'audit' for an
 * official audit file, null when it has none (Student-defined).
 */
function minorSourceKind(def) {
  const file = def && def.source_file ? String(def.source_file) : '';
  if (!file) return null;
  return /\.html?$/i.test(file) ? 'catalog' : 'audit';
}

/** The double counting rule text comes verbatim from the official files; show its " - " separators as commas. */
function plainDataText(text) {
  return String(text == null ? '' : text).replace(/\s+[-‒-―]\s+/g, ', ');
}

// ── Profile-aware annotations ────────────────────────────

/**
 * For a student: _majorKind ('degree', 'gened' or null) for their major,
 * _minorMatches (their minors the course can count for) and _doubleCounter
 * (both). Cleared for everyone else.
 */
function annotateDoubleCounters(courses, profile, minorIndex) {
  const student = !!(profile && profile.role === 'student');
  const minors = student ? getProfileMinors(profile) : [];
  for (const c of courses || []) {
    c._majorKind = null;
    c._minorMatches = [];
    c._doubleCounter = false;
    if (!student || isCourseHidden(c)) continue;
    c._majorKind = majorCountKind(c, profile.primary);
    c._minorMatches = minors.filter(mc => courseCountsForMinor(c, mc, minorIndex));
    c._doubleCounter = !!c._majorKind && c._minorMatches.length > 0;
  }
}

function annotateMultiProgram(courses) {
  const PROGRAMS = MAJOR_ORDER;
  for (const c of courses) {
    const req = c.requirements || {};
    let n = 0;
    for (const p of PROGRAMS) {
      if (Array.isArray(req[p]) && req[p].length > 0) n++;
    }
    c._programCount = n;
  }
}
