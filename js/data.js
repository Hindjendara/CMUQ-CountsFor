// ============================================================
// CountsFor — Data Transformation Layer
// Parses API data into trees, indexes, and display-ready structures
// ============================================================

const MAJOR_META = {
  CS: { code: 'CS', label: 'Computer Science',       color: 'cs', degree: 'B.S. in Computer Science' },
  IS: { code: 'IS', label: 'Information Systems',    color: 'is', degree: 'B.S. in Information Systems' },
  BA: { code: 'BA', label: 'Business Administration',color: 'ba', degree: 'B.S. in Business Administration' },
  BS: { code: 'BS', label: 'Biological Sciences',    color: 'bs', degree: 'B.S. in Biological Sciences' },
  AI: { code: 'AI', label: 'Artificial Intelligence', color: 'ai', degree: 'B.S. in Artificial Intelligence', dataPending: true },
  GS: { code: 'GS', label: 'General Studies',         color: 'gs', degree: 'B.S. in General Studies', dataPending: true },
};

const MAJOR_ORDER = ['CS', 'IS', 'BA', 'BS'];
// AI and GS have no requirement data yet; add them to MAJOR_ORDER once their specs exist.

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
const LABEL_OVERRIDES = {
  'BS in Computer Science': 'CS Degree Requirements',
  'BS in Information Systems': 'IS Degree Requirements',
  'BS in Business Administration': 'BA Degree Requirements',
  'BS in Biological Sciences': 'Biology Degree Requirements',
  'EY2022 Qatar Business Administration - University Core Requirements': 'University Core',
  'EY2024+ Qatar Business Administration - University Core Requirements': 'University Core',
  'Mathematics and Probability': 'Math & Probability',
  'Computer Science': 'Computer Science Core',
  'Science and Engineering': 'Science & Engineering',
  'Science and Engineering (CS, AI, & HCI)': 'Sci & Eng (CS/AI/HCI)',
  'Science and Engineering (CB)': 'Sci & Eng (Comp. Bio)',
  'Science/Engineering, Any Department (4 courses)': 'Any Department (4 courses)',
  'Science/Engineering, Same Department (2 courses)': 'Same Department (2 courses)',
  'Concentration - select 1 concentration from the list below': 'Concentrations',
  'Information Systems Core': 'IS Core',
  'Information Systems Breadth': 'IS Breadth',
  'Technical Core': 'Technical Core',
  'Disciplinary Perspectives': 'Disciplinary Perspectives',
  'Business Foundations': 'Business Foundations',
  'Biological Sciences': 'Biological Sciences Core',
  'Mathematics, Physics and Computer Science': 'Math, Physics & CS',
  'Biological Sciences Electives': 'Bio Electives',
  'Advanced Biological Sciences Electives': 'Advanced Bio Electives',
  'Departmental Electives Group': 'Departmental Electives',
  'Interdisciplinary Electives Group': 'Interdisciplinary Electives',
  'Cultural/Global Understanding': 'Cultural & Global Understanding',
  'Cognition, Choice, and Behavior (CS, CB, & HCI)': 'Cognition, Choice & Behavior',
  'Category 1: Cognition': 'Category 1: Cognition',
  'Category 2: Economic, Political, and Social Institutions': 'Category 2: Institutions',
  'Category 3: Cultural Analysis': 'Category 3: Cultural Analysis',
  'Concentration': 'Concentrations',
  'Data Science': 'Data Science',
  'Data Science Concentration': 'Data Science Concentration',
  'Digitalization': 'Digitalization',
  'Digitalization Concentration': 'Digitalization Concentration',
  'Information Security and Privacy': 'Info Security & Privacy',
  'Information Security and Privacy Concentration': 'Info Security Concentration',
  'Quantitative Analysis and Research Methods': 'Quantitative Analysis',
  'Innovation and Entrepreneurship': 'Innovation & Entrepreneurship',
  'Professional Communications': 'Professional Communications',
  'Additional Disciplines (Business/Design/Engineering)': 'Business/Design/Engineering',
  'Managing Digital Transformation': 'Managing Digital Transformation',
  'Perspectives on Justice and Injustice': 'Justice & Injustice',
  'Intercultural and Global Inquiry': 'Intercultural & Global Inquiry',
  'Management Game/ Consulting Project': 'Management Game / Consulting',
  'Global Economics & Business': 'Global Economics & Business',
  'Business Analytics & Technologies': 'Business Analytics & Tech',
  'Operations Management': 'Operations Management',
  'Strategic Management': 'Strategic Management',
  'Marketing Management': 'Marketing Management',
  'Required Biology Electives': 'Required Bio Electives',
  'Recommended Biology Electives': 'Recommended Bio Electives',
  'Non-Technical Breadth Electives': 'Non-Technical Breadth',
  'CMU First Year Writing': 'First Year Writing',
  'Global, Cultural, and Diverse Perspectives': 'Global & Cultural Perspectives',
  'Informational Literacy': 'Informational Literacy',
  'Scientific Reasoning': 'Scientific Reasoning',
  // 70-509 BA leaf from the mapping data; the stored path keeps its text.
  'Independent Study - Special Permission Required': 'Independent Study (Special Permission Required)',
};

// ── Fulfillment rules (manually annotated from audit specs) ──
const FULFILLMENT_RULES = {};

function setRule(major, pathSuffix, rule) {
  if (!FULFILLMENT_RULES[major]) FULFILLMENT_RULES[major] = {};
  FULFILLMENT_RULES[major][pathSuffix] = rule;
}

// CS rules
setRule('CS', 'Computer Science', { type: 'take_all', label: 'take all' });
setRule('CS', 'Artificial Intelligence Elective', { type: 'pick', n: 1, label: 'pick 1' });
setRule('CS', 'Domains Elective', { type: 'pick', n: 1, label: 'pick 1' });
setRule('CS', 'Logics & Languages Elective', { type: 'pick', n: 1, label: 'pick 1' });
setRule('CS', 'Software Systems Elective', { type: 'pick', n: 1, label: 'pick 1' });
setRule('CS', 'Introduction to Computer Systems', { type: 'pick', n: 1, label: 'pick 1' });
setRule('CS', 'Mathematics and Probability', { type: 'take_all', label: 'take all' });
setRule('CS', 'Calculus', { type: 'take_all', label: 'take all' });
setRule('CS', '3D Calculus', { type: 'pick', n: 1, label: 'pick 1' });
setRule('CS', 'Mathematical Foundations for CS', { type: 'pick', n: 1, label: 'pick 1' });
setRule('CS', 'Matrix/Linear Algebra', { type: 'pick', n: 1, label: 'pick 1' });
setRule('CS', 'Probability', { type: 'pick', n: 1, label: 'pick 1' });
setRule('CS', 'Probability and Statistics 36-22x sequence', { type: 'optional', label: 'optional path' });
setRule('CS', 'Probability and Statistics 36-23x sequence', { type: 'optional', label: 'optional path' });
setRule('CS', 'Technical Communication', { type: 'pick', n: 1, label: 'pick 1' });
setRule('CS', 'SCS Electives', { type: 'min_units', units: 19, label: '≥19 units' });
setRule('CS', 'First-year Immigration Course', { type: 'optional', label: 'optional' });
setRule('CS', 'Computing @ Carnegie Mellon', { type: 'required', label: 'required' });
setRule('CS', 'First Year Writing', { type: 'pick', n: 1, label: 'pick 1' });
setRule('CS', 'Humanities/Arts Electives', { type: 'min_units', units: 30, label: '≥30 units' });
setRule('CS', 'Category 1: Cognition', { type: 'pick', n: 1, label: '≥1 course' });
setRule('CS', 'Category 2: Economic, Political, and Social Institutions', { type: 'pick', n: 1, label: '≥1 course' });
setRule('CS', 'Category 3: Cultural Analysis', { type: 'pick', n: 1, label: '≥1 course' });
setRule('CS', 'Science and Engineering', { type: 'min_units', units: 30, label: '≥30 units' });

// IS rules
setRule('IS', 'Information Systems Core', { type: 'take_all', label: 'take all' });
setRule('IS', 'HCI Requirement', { type: 'pick', n: 1, label: 'pick 1' });
setRule('IS', 'Managing Digital Transformation', { type: 'pick', n: 1, label: 'pick 1' });
setRule('IS', 'Professional Communications', { type: 'pick', n: 1, label: 'pick 1' });
setRule('IS', 'Quantitative Analysis and Research Methods', { type: 'pick', n: 1, label: 'pick 1' });
setRule('IS', 'Innovation and Entrepreneurship', { type: 'pick', n: 1, label: 'pick 1' });
setRule('IS', 'Computer Science Requirement', { type: 'pick', n: 1, label: 'pick 1' });
setRule('IS', 'Mathematics', { type: 'pick', n: 1, label: 'pick 1' });
setRule('IS', 'Data Science Technical Core', { type: 'pick', n: 1, label: 'pick any' });
setRule('IS', 'Data Science Applications', { type: 'pick', n: 1, label: 'pick any' });
setRule('IS', 'Summative Course', { type: 'required', label: 'required' });
setRule('IS', 'Enabling Methods, Techniques and Tools', { type: 'pick', n: 1, label: 'pick any' });
setRule('IS', 'Orthogonal Topics', { type: 'pick', n: 1, label: 'pick any' });
setRule('IS', 'Regulatory and Behavioral Core', { type: 'pick', n: 1, label: 'pick any' });
setRule('IS', 'Technical Core', { type: 'pick', n: 1, label: 'pick any' });
setRule('IS', 'Data Science Concentration', { type: 'min_units', units: 36, label: '≥36 units' });
setRule('IS', 'Communication', { type: 'min_units', units: 9, label: '≥9 units' });
setRule('IS', 'Computational Thinking', { type: 'min_units', units: 9, label: '≥9 units' });
setRule('IS', 'Contextual Thinking', { type: 'min_units', units: 9, label: '≥9 units' });
setRule('IS', 'Scientific Inquiry', { type: 'min_units', units: 9, label: '≥9 units' });
setRule('IS', 'Data Analysis', { type: 'min_units', units: 9, label: '≥9 units' });
setRule('IS', 'Intercultural and Global Inquiry', { type: 'min_units', units: 9, label: '≥9 units' });
setRule('IS', 'Humanities', { type: 'min_units', units: 9, label: '≥9 units' });
setRule('IS', 'Social Sciences', { type: 'min_units', units: 9, label: '≥9 units' });
setRule('IS', 'The Arts', { type: 'min_units', units: 9, label: '≥9 units' });
setRule('IS', 'Logic/Mathematical Reasoning', { type: 'min_units', units: 9, label: '≥9 units' });
setRule('IS', 'Additional Disciplines (Business/Design/Engineering)', { type: 'min_units', units: 6, label: '≥6 units' });
setRule('IS', 'Grand Challenge Seminar', { type: 'min_units', units: 9, label: '≥9 units' });
setRule('IS', 'Perspectives on Justice and Injustice', { type: 'min_units', units: 9, label: '≥9 units' });

// BA rules
setRule('BA', 'Business Core', { type: 'take_all', label: 'take all' });
setRule('BA', 'BLE', { type: 'take_all', label: 'take all' });
setRule('BA', 'Calculus', { type: 'required', label: 'required' });
setRule('BA', 'Multivariate Analysis', { type: 'required', label: 'required' });
setRule('BA', 'Models of Optimization', { type: 'required', label: 'required' });
setRule('BA', 'Microeconomics', { type: 'pick', n: 1, label: 'pick 1' });
setRule('BA', 'Intermed. Micro or Macro', { type: 'pick', n: 1, label: 'pick 1' });
setRule('BA', 'Prob/Stats for Business', { type: 'pick', n: 1, label: 'pick 1' });
setRule('BA', 'Regression Analysis', { type: 'pick', n: 1, label: 'pick 1' });
setRule('BA', 'Management Game/ Consulting Project', { type: 'take_all', label: 'take all' });
setRule('BA', 'Business Electives', { type: 'min_units', units: 18, label: '≥18 units' });
setRule('BA', 'Required Courses', { type: 'take_all', label: 'take all' });
setRule('BA', 'Two Area Electives', { type: 'pick', n: 2, label: 'pick 2' });
setRule('BA', 'Three Area Electives', { type: 'pick', n: 3, label: 'pick 3' });
setRule('BA', 'Choose One', { type: 'pick', n: 1, label: 'pick 1' });
setRule('BA', 'Select 2 Mini Writing Courses', { type: 'pick', n: 2, label: 'pick 2' });
setRule('BA', 'Semester Long Writing Course', { type: 'pick', n: 1, label: 'pick 1' });

// BS rules
setRule('BS', 'Modern Biology', { type: 'pick', n: 1, label: 'pick 1' });
setRule('BS', 'Colloquia', { type: 'take_all', label: 'take all' });
setRule('BS', 'Genetics', { type: 'required', label: 'required' });
setRule('BS', 'Biochemistry', { type: 'pick', n: 1, label: 'pick 1' });
setRule('BS', 'Introduction to Computational Biology', { type: 'pick', n: 1, label: 'pick 1' });
setRule('BS', 'Cell Biology', { type: 'pick', n: 1, label: 'pick 1' });
setRule('BS', 'Experimental Techniques in Molecular Biology', { type: 'required', label: 'required' });
setRule('BS', 'Experimental Biochemistry', { type: 'pick', n: 1, label: 'pick 1' });
setRule('BS', 'Topics in Research', { type: 'take_all', label: 'take all' });
setRule('BS', 'Advanced Biological Sciences Electives', { type: 'min_units', units: 18, label: '≥18 units' });
setRule('BS', 'Departmental Electives Group', { type: 'pick', n: 1, label: 'if needed' });
setRule('BS', 'Interdisciplinary Electives Group', { type: 'max_courses', n: 3, label: '≤3 courses' });
setRule('BS', 'Undergraduate Research', { type: 'max_units', units: 18, label: '≤18 units' });
setRule('BS', 'Modern Chemistry I', { type: 'pick', n: 1, label: 'pick 1' });
setRule('BS', 'Modern Chemistry II', { type: 'required', label: 'required' });
setRule('BS', 'Organic Chemistry I', { type: 'pick', n: 1, label: 'pick 1' });
setRule('BS', 'Organic Chemistry II', { type: 'pick', n: 1, label: 'pick 1' });
setRule('BS', 'General Chemistry Lab', { type: 'pick', n: 1, label: 'pick 1' });
setRule('BS', 'Organic Chemistry Lab', { type: 'pick', n: 1, label: 'pick 1' });
setRule('BS', 'Programming', { type: 'pick', n: 1, label: 'pick 1' });
setRule('BS', 'Calculus I', { type: 'pick', n: 1, label: 'pick 1' });
setRule('BS', 'Calculus II', { type: 'pick', n: 1, label: 'pick 1' });
setRule('BS', 'Physics I', { type: 'pick', n: 1, label: 'pick 1' });
setRule('BS', 'Physics II', { type: 'pick', n: 1, label: 'pick 1' });
setRule('BS', 'Non-Technical Breadth Electives', { type: 'min_units', units: 63, label: '≥63 units' });
setRule('BS', 'STEM Course', { type: 'pick', n: 1, label: 'elective' });

// ── Rows the app keeps but never lists ───────────────────────
// Set by data/apply_mapping_overlays.py from data/mapping_overlays.json:
// - superseded_by: a retired number ("renumbered"); the current row carries
//   its mappings and lists it in previous_codes.
// - qatar_only: shown only while its SOC offerings include the Qatar campus.
function courseOfferedInQatar(course) {
  return getCourseOfferings(course).some(o => o && o.campus === 'Qatar' && !o.cancelled);
}

function isCourseHidden(course) {
  if (!course) return true;
  if (course.superseded_by) return true;
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
  node.children = childArray;
  return node;
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
function splitTreeSections(tree, majorCode) {
  const degree = [];
  const gened = [];
  
  for (const child of tree.children) {
    // Check if this top-level node is GenEd
    const isGenedSection = child.rawLabel === 'GenEd' || 
                           child.rawLabel.includes('University Core') ||
                           child.rawLabel.includes('EY2022') ||
                           child.rawLabel.includes('EY2024');
    
    if (isGenedSection) {
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

function _emptyRequirements() {
  const out = {};
  for (const m of MAJOR_ORDER) out[m] = [];
  return out;
}

/**
 * Returns { courses, archived }. Each edited course gets `_edit` (the override)
 * and `_catalog` (the scraped values it replaced) so the admin editor can show both.
 */
function applyCourseOverrides(courses, overrides) {
  if (!overrides || !overrides.length) return { courses, archived: [] };
  // Copy before editing: fetchAllCourses caches the parsed catalog, and a later
  // reload must start from the scraped values, not from edited objects.
  courses = courses.slice();
  // Exact codes only, no renumbering aliases: an override keyed by a retired
  // number edits or archives that retired row (which is never deleted, so an
  // is_new override on it finds it and adds nothing), never its current row.
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
    if (o.requirements) {
      if (!course._added && !('requirements' in course._catalog)) course._catalog.requirements = course.requirements;
      course.requirements = Object.assign(_emptyRequirements(), o.requirements);
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

/** Every requirement path used in the catalog, per program, with its Gen Ed flag. */
function knownRequirementPaths(courses) {
  const out = {};
  for (const m of MAJOR_ORDER) out[m] = new Map();
  for (const c of courses) {
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
 * [oldCode, i] pairs: a retired number and the position of the current row
 * that replaces it. Comes from superseded_by on the retired row and from
 * previous_codes on the current row (a code still held by a row that is not
 * superseded is never aliased).
 */
function renumberedAliases(courses) {
  const pos = new Map();
  courses.forEach((c, i) => {
    const k = normalizeCourseCode(c && c.course_code);
    if (k && !pos.has(k)) pos.set(k, i);
  });
  const out = [];
  courses.forEach((c, i) => {
    if (!c) return;
    if (c.superseded_by) {
      const j = pos.get(normalizeCourseCode(c.superseded_by));
      const k = normalizeCourseCode(c.course_code);
      if (k && j !== undefined && !courses[j].superseded_by) out.push([k, j]);
      return;
    }
    for (const old of (Array.isArray(c.previous_codes) ? c.previous_codes : [])) {
      const k = normalizeCourseCode(old);
      const holder = pos.get(k);
      if (k && (holder === undefined || courses[holder].superseded_by)) out.push([k, i]);
    }
  });
  return out;
}

// ── Build course index ──────────────────────────────────────
// Old numbers resolve to the current row, so wishlist items, flags, plans and
// search counts saved under a retired code still find the course.
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
  for (const [oldCode, i] of renumberedAliases(courses)) {
    index[oldCode] = courses[i];
    index[oldCode.replace(/-/g, '')] = courses[i];
  }
  return index;
}

function lookupCourse(index, code) {
  if (!code) return null;
  return index[normalizeCourseCode(code)] || index[code] || null;
}

/** The code a stored code resolves to (an old number gives the current code). */
function resolveCourseCode(index, code) {
  const c = lookupCourse(index, code);
  return c ? c.course_code : normalizeCourseCode(code);
}

/** True when two stored codes name the same course (old numbers included). */
function sameCourseCode(index, a, b) {
  if (!a || !b) return false;
  return resolveCourseCode(index, a) === resolveCourseCode(index, b);
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
  const minorMajor = (typeof getMinorAsMajorCode === 'function') ? getMinorAsMajorCode(profile) : null;
  if (minorMajor && present.includes(minorMajor) && !lead.includes(minorMajor)) {
    lead.push(minorMajor);
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
function sortSemesters(semesters) {
  if (!semesters || !Array.isArray(semesters)) return [];
  const seasonOrder = { 'S': 1, 'M': 2, 'N': 3, 'F': 4 };
  return [...new Set(semesters)].sort((a, b) => {
    const yearA = parseInt(a.substring(1));
    const yearB = parseInt(b.substring(1));
    if (yearA !== yearB) return yearB - yearA; // newest first
    return (seasonOrder[b[0]] || 0) - (seasonOrder[a[0]] || 0);
  });
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

// ── Semester / modality filters (Phase 3) ────────────────────
const SEMESTER_OPTIONS = [
  { code: 'F26', label: 'Fall 2026' },
  { code: 'M26', label: 'Summer 2026' },
  { code: 'S26', label: 'Spring 2026' },
  { code: 'F25', label: 'Fall 2025' },
  { code: 'M25', label: 'Summer 2025' },
];

const MODALITY_OPTIONS = [
  { id: 'all', label: 'All' },
  { id: 'in_person', label: 'In Person' },
  { id: 'remote', label: 'Remote' },
  { id: 'hybrid', label: 'Hybrid' },
];

function normalizeSemesterCode(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const code = raw.trim();
  if (/^[FSMN]\d{2}$/i.test(code)) return code.toUpperCase();
  const hit = SEMESTER_OPTIONS.find(s => s.label === code || s.code === code);
  return hit ? hit.code : null;
}

/**
 * Semesters that appear in the bundled catalog's live offerings.
 * Summer (M-prefix) is included whenever the SOC scrape provides it.
 */
function availableSemesterOptions(courses, alwaysInclude) {
  const present = new Set();
  for (const c of courses || []) {
    for (const o of (c && Array.isArray(c.offerings) ? c.offerings : [])) {
      const code = normalizeSemesterCode(o.semester_code || o.semesterCode || o.semester);
      if (code) present.add(code);
    }
  }
  const allOption = { code: 'all', label: 'All semesters' };
  let terms = present.size === 0
    ? SEMESTER_OPTIONS.slice()
    : SEMESTER_OPTIONS.filter(s => present.has(s.code));
  if (alwaysInclude && alwaysInclude !== 'all') {
    const normalized = normalizeSemesterCode(alwaysInclude) || alwaysInclude;
    if (normalized && !terms.some(s => s.code === normalized)) {
      const hit = SEMESTER_OPTIONS.find(s => s.code === normalized);
      if (hit) terms = [hit, ...terms];
    }
  }
  return [allOption, ...terms];
}

function semesterLabel(code) {
  if (code === 'all') return 'All semesters';
  const hit = SEMESTER_OPTIONS.find(s => s.code === code);
  if (hit) return hit.label;
  if (!code || code.length < 3) return code || '';
  const seasonMap = { F: 'Fall', S: 'Spring', M: 'Summer', N: 'Fall mini' };
  const season = seasonMap[code[0]] || code[0];
  return `${season} 20${code.slice(1)}`;
}

function getCourseOfferings(course) {
  if (!course) return [];
  if (Array.isArray(course.offerings) && course.offerings.length) {
    return course.offerings;
  }
  // Legacy soc_sections → normalized offering shape
  return (course.soc_sections || []).map(s => ({
    semester: s.semester || semesterLabel(s.semester_code || 'F26'),
    semester_code: s.semester_code || 'F26',
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

function groupOfferingsBySection(offerings) {
  const groups = [];
  const index = new Map();
  for (const o of offerings || []) {
    const key = [
      o.semester_code || '',
      o.section || '',
      o.campus || '',
    ].join('::');
    if (!index.has(key)) {
      const g = {
        semester_code: o.semester_code,
        section: o.section,
        campus: o.campus,
        modality: o.modality || o.delivery_mode || '',
        meetings: [],
      };
      index.set(key, g);
      groups.push(g);
    }
    index.get(key).meetings.push(o);
  }
  return groups;
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

function findPlanConflicts(items) {
  const conflicts = new Set();
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      if (planEntriesOverlap(items[i], items[j])) {
        conflicts.add(items[i].id);
        conflicts.add(items[j].id);
      }
    }
  }
  return conflicts;
}

function countPlanConflictPairs(items) {
  let pairs = 0;
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      if (planEntriesOverlap(items[i], items[j])) pairs++;
    }
  }
  return pairs;
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

// ── Minor course lists (T5) ──────────────────────────────────
function courseCountsForMinor(course, minorCode, minorCourseList) {
  if (!minorCode || !course) return false;
  const list = minorCourseList && minorCourseList[minorCode];
  if (Array.isArray(list)) {
    return list.includes(course.course_code);
  }
  const mapped = MINOR_CODE_TO_MAJOR[minorCode];
  if (!mapped) return false;
  const reqs = course.requirements || {};
  return Array.isArray(reqs[mapped]) && reqs[mapped].length > 0;
}

// ── Profile-aware annotations ────────────────────────────

function annotateDoubleCounters(courses, profile, minorCourseList) {
  const viewMode = computeViewMode(profile);
  if (viewMode !== 'focused-dual') {
    for (const c of courses) c._doubleCounter = false;
    return;
  }
  const p = profile.primary;
  const minors = getProfileMinors(profile);
  if (!minors.length) {
    for (const c of courses) c._doubleCounter = false;
    return;
  }
  for (const c of courses) {
    if (isCourseHidden(c)) { c._doubleCounter = false; continue; }
    const req = c.requirements || {};
    const hasPrimary = Array.isArray(req[p]) && req[p].length > 0;
    const hasSecondary = minors.some(mc => courseCountsForMinor(c, mc, minorCourseList));
    c._doubleCounter = hasPrimary && hasSecondary;
  }
}

function annotateMultiProgram(courses) {
  const PROGRAMS = ['CS', 'IS', 'BA', 'BS'];
  for (const c of courses) {
    const req = c.requirements || {};
    let n = 0;
    for (const p of PROGRAMS) {
      if (Array.isArray(req[p]) && req[p].length > 0) n++;
    }
    c._programCount = n;
  }
}
