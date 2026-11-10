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

/** The statuses a student can give a course. Not taken is no entry at all. */
const COURSE_STATUSES = ['in_progress', 'completed'];

/** localStorage key of the student's course statuses: { "15-122": "completed" }. */
const COURSE_STATUS_KEY = 'cf_course_status';

/** Keep only well formed entries, with canonical course codes. */
function normalizeCourseStatuses(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [code, status] of Object.entries(raw)) {
    const key = normalizeCourseCode(code);
    if (key && COURSE_STATUSES.includes(status)) out[key] = status;
  }
  return out;
}

/** The status control cycles: not taken, in progress, completed, not taken. */
function nextCourseStatus(status) {
  if (status === 'in_progress') return 'completed';
  if (status === 'completed') return '';
  return 'in_progress';
}

function courseStatusLabel(status) {
  if (status === 'completed') return 'Completed';
  if (status === 'in_progress') return 'In progress';
  return 'Not taken';
}

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

/** The rule chip of a category, in the style of the major chips ("pick 1"). */
function minorRuleLabel(rule, childCount) {
  if (!rule) return '';
  const units = rule.units != null ? `≥${rule.units} units` : '';
  const withUnits = text => (units ? `${text}, ${units}` : text);
  switch (rule.type) {
    case 'take_all': return 'take all';
    case 'required': return 'required';
    case 'pick':
      if (rule.count === 'children') return `pick ${rule.n} of ${childCount}`;
      if (rule.count === 'courses') return withUnits(`${rule.n} courses`);
      return withUnits(`pick ${rule.n}`);
    case 'min_units': return units || 'units';
    case 'max_units': return rule.units != null ? `≤${rule.units} units` : 'optional';
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

/**
 * One minor as a requirement tree with the same node shape as the major trees
 * (label, path, children, courses, rule), so the same tree components render
 * it. Paths are category ids joined by "---"; tree keys are "minor:<code>".
 */
function buildMinorTree(minorCode, def, courses, courseIndex) {
  const treeKey = 'minor:' + minorCode;
  function build(cat, parentPath, depth) {
    const path = parentPath ? parentPath + '---' + cat.id : cat.id;
    const children = (cat.children || []).map(ch => build(ch, path, depth + 1));
    const hasList = Array.isArray(cat.courses) && cat.courses.length > 0;
    const expanded = (hasList || cat.select)
      ? expandMinorCategory(cat, courses, courseIndex)
      : { courses: [], missing: [] };
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
 * eligible maps a course code to the paths of the categories that accept it.
 */
function buildMinorIndex(data, courses, courseIndex) {
  const index = { order: [], byCode: {} };
  const minors = (data && data.minors) || {};
  for (const [code, def] of Object.entries(minors)) {
    if (!def || typeof def !== 'object') continue;
    const tree = buildMinorTree(code, def, courses, courseIndex);
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
 * A student's progress through one minor, from their course statuses.
 *
 * One course fills one category, so every marked course is assigned to at
 * most one bottom-level category. The categories with the fewest matching
 * marked courses are filled first (then the narrower lists, then file order),
 * each with completed courses before in progress ones and only until its rule
 * is met. Then a group that counts courses or units across its parts
 * (Sociology Electives, Writing's Core Writing) takes more courses into its
 * parts until its own total is met; a max_units part never passes its cap.
 *
 * A category is "complete" when its completed courses meet its rule,
 * "in_progress" when its completed and in progress courses meet it,
 * "remaining" otherwise, and "optional" for a max_units part.
 *
 * Returns { byPath: Map(path, status), assigned: Map(code, path), summary }.
 */
function computeMinorProgress(tree, statuses) {
  const st = statuses || {};
  const nodes = [];
  (function walk(node) {
    for (const ch of node.children || []) { nodes.push(ch); walk(ch); }
  })(tree || { children: [] });

  const unitsOf = new Map();
  const isMarked = code => st[code] === 'completed' || st[code] === 'in_progress';
  const rank = code => (st[code] === 'completed' ? 0 : 1);
  const unitsSum = codes => codes.reduce((n, c) => n + (unitsOf.get(c) || 0), 0);

  const leaves = new Map();
  nodes.forEach((node, order) => {
    if ((node.children || []).length) return;
    const cands = [];
    for (const c of node.courses || []) {
      if (!isMarked(c.code) || cands.includes(c.code)) continue;
      cands.push(c.code);
      unitsOf.set(c.code, Number(c.units) || 0);
    }
    cands.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
    leaves.set(node.path, { node, cands, taken: [], order });
  });

  function leafMet(node, codes) {
    const r = node.rule || {};
    switch (r.type) {
      case 'take_all':
      case 'required': {
        const need = (node.listed && node.listed.length) ? node.listed : (node.courses || []).map(c => c.code);
        return need.length > 0 && need.every(code => codes.includes(code));
      }
      case 'pick':
        return codes.length >= (r.n || 0) && (r.units == null || unitsSum(codes) >= r.units);
      case 'min_units':
        return unitsSum(codes) >= (r.units || 0);
      case 'max_units':
        return true;
      default:
        return codes.length > 0;
    }
  }

  const assigned = new Map();
  const take = (li, code) => { li.taken.push(code); assigned.set(code, li.node.path); };

  // Phase 1: each category up to its own rule.
  const firstPass = Array.from(leaves.values())
    .filter(li => (li.node.rule || {}).type !== 'max_units')
    .sort((a, b) => a.cands.length - b.cands.length
      || (a.node.courses || []).length - (b.node.courses || []).length
      || a.order - b.order);
  for (const li of firstPass) {
    for (const code of li.cands) {
      if (leafMet(li.node, li.taken)) break;
      if (!assigned.has(code)) take(li, code);
    }
  }

  // Phase 2: groups that count courses or units across their parts.
  const leavesUnder = node => {
    const out = [];
    (function walk(n) {
      if (!(n.children || []).length) { if (leaves.has(n.path)) out.push(leaves.get(n.path)); return; }
      for (const ch of n.children) walk(ch);
    })(node);
    return out;
  };
  const groups = nodes.filter(n => (n.children || []).length).reverse();
  for (const g of groups) {
    const r = g.rule || {};
    const byCourses = r.type === 'pick' && r.count === 'courses';
    if (!byCourses && r.type !== 'min_units') continue;
    const parts = leavesUnder(g);
    const groupMet = () => {
      const taken = parts.flatMap(li => li.taken);
      if (byCourses) return taken.length >= (r.n || 0) && (r.units == null || unitsSum(taken) >= r.units);
      return unitsSum(taken) >= (r.units || 0);
    };
    for (const li of parts) {
      const cap = (li.node.rule || {}).type === 'max_units' ? li.node.rule.units : null;
      for (const code of li.cands) {
        if (groupMet()) break;
        if (assigned.has(code)) continue;
        if (cap != null && unitsSum(li.taken) + (unitsOf.get(code) || 0) > cap) continue;
        take(li, code);
      }
    }
  }

  // Status of every category, bottom up.
  const byPath = new Map();
  function statusOf(node) {
    const r = node.rule || {};
    const kids = (node.children || []).map(statusOf);
    const taken = kids.length ? kids.flatMap(k => k.courses) : ((leaves.get(node.path) || {}).taken || []).slice();
    const done = taken.filter(c => st[c] === 'completed');
    const res = {
      kind: kids.length ? 'group' : 'leaf',
      rule: r.type || null,
      courses: taken,
      done: done.length,
      inProgress: taken.length - done.length,
      doneUnits: unitsSum(done),
      inProgressUnits: unitsSum(taken) - unitsSum(done),
      state: 'remaining',
      need: {},
      left: {},
    };
    if (!kids.length) {
      if (r.type === 'max_units') {
        res.state = 'optional';
        res.need = { units: r.units };
      } else {
        res.state = leafMet(node, done) ? 'complete' : leafMet(node, taken) ? 'in_progress' : 'remaining';
        if (r.type === 'take_all' || r.type === 'required') {
          const need = (node.listed && node.listed.length) ? node.listed.length : (node.courses || []).length;
          res.need = { courses: need };
          res.left = { courses: Math.max(0, need - taken.length) };
        } else if (r.type === 'pick') {
          res.need = { courses: r.n || 0, units: r.units == null ? null : r.units };
          res.left = {
            courses: Math.max(0, (r.n || 0) - taken.length),
            units: r.units == null ? 0 : Math.max(0, r.units - unitsSum(taken)),
          };
        } else if (r.type === 'min_units') {
          res.need = { units: r.units || 0 };
          res.left = { units: Math.max(0, (r.units || 0) - unitsSum(taken)) };
        }
      }
    } else {
      const parts = kids.filter(k => k.state !== 'optional');
      const nDone = parts.filter(k => k.state === 'complete').length;
      const nStarted = parts.filter(k => k.state === 'complete' || k.state === 'in_progress').length;
      res.partsDone = nDone;
      res.partsTotal = parts.length;
      if (r.type === 'pick' && r.count === 'children') {
        const n = r.n || 1;
        res.need = { parts: n };
        res.left = { parts: Math.max(0, n - nStarted) };
        res.state = nDone >= n ? 'complete' : nStarted >= n ? 'in_progress' : 'remaining';
      } else {
        let totalDone = true;
        let totalAll = true;
        res.need = { parts: parts.length };
        res.left = { parts: parts.length - nStarted };
        if (r.type === 'pick' && r.count === 'courses') {
          totalDone = done.length >= (r.n || 0);
          totalAll = taken.length >= (r.n || 0);
          res.need.courses = r.n || 0;
          res.left.courses = Math.max(0, (r.n || 0) - taken.length);
        } else if (r.type === 'min_units') {
          totalDone = res.doneUnits >= (r.units || 0);
          totalAll = unitsSum(taken) >= (r.units || 0);
          res.need.units = r.units || 0;
          res.left.units = Math.max(0, (r.units || 0) - unitsSum(taken));
        }
        res.state = (nDone === parts.length && totalDone) ? 'complete'
          : (nStarted === parts.length && totalAll) ? 'in_progress' : 'remaining';
      }
    }
    byPath.set(node.path, res);
    return res;
  }
  const top = ((tree && tree.children) || []).map(statusOf).filter(s => s.state !== 'optional');
  const complete = top.filter(s => s.state === 'complete').length;
  const inProgress = top.filter(s => s.state === 'in_progress').length;
  const summary = {
    total: top.length,
    complete,
    inProgress,
    remaining: top.length - complete - inProgress,
    marked: assigned.size,
    state: !top.length ? 'none'
      : complete === top.length ? 'complete'
      : complete + inProgress === top.length ? 'in_progress' : 'remaining',
  };
  return { byPath, assigned, summary };
}

/**
 * Short text for a category's status chip: { cls, text } with cls one of
 * done, ip, left, opt; null when there is nothing to say.
 */
function minorStatusText(s) {
  if (!s) return null;
  if (s.state === 'complete') return { cls: 'done', text: 'Done' };
  if (s.state === 'in_progress') return { cls: 'ip', text: 'In progress' };
  const n = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;
  if (s.state === 'optional') {
    const used = s.doneUnits + s.inProgressUnits;
    return used ? { cls: 'opt', text: `${used} units used` } : null;
  }
  const left = s.left || {};
  const bits = [];
  if (left.courses) bits.push(n(left.courses, 'course'));
  if (left.units) bits.push(`${left.units} units`);
  if (!bits.length && left.parts) bits.push(n(left.parts, 'part'));
  return { cls: 'left', text: bits.length ? `${joinWithAnd(bits)} left` : 'Not met yet' };
}

/** One line for a minor header, e.g. "2 of 5 requirements done, 1 in progress, 2 left". */
function minorSummaryText(summary) {
  if (!summary || !summary.total) return '';
  const parts = [`${summary.complete} of ${summary.total} requirement${summary.total === 1 ? '' : 's'} done`];
  if (summary.inProgress) parts.push(`${summary.inProgress} in progress`);
  if (summary.remaining) parts.push(`${summary.remaining} left`);
  return parts.join(', ');
}

/** Distinct marked courses under a tree node: { done, inProgress }. */
function countMarkedCourses(node, statuses) {
  const st = statuses || {};
  const seen = new Set();
  let done = 0;
  let inProgress = 0;
  (function walk(n) {
    for (const c of (n && n.courses) || []) {
      const code = normalizeCourseCode(c.code || c.course_code);
      if (seen.has(code)) continue;
      seen.add(code);
      if (st[code] === 'completed') done++;
      else if (st[code] === 'in_progress') inProgress++;
    }
    for (const ch of (n && n.children) || []) walk(ch);
  })(node);
  return { done, inProgress };
}

/** The double counting rules of a minor for one major (by_major overrides the categories). */
function minorDoubleCountRules(def, majorCode) {
  const dc = (def && def.double_count) || {};
  const forMajor = (dc.by_major && majorCode && dc.by_major[majorCode]) || {};
  return {
    limit: typeof dc.max_with_major === 'number' ? dc.max_with_major : null,
    known: dc.text != null || typeof dc.max_with_major === 'number',
    genEdExempt: dc.gen_ed_exempt !== false,
    noLimit: forMajor.no_limit_categories || dc.no_limit_categories || [],
    noSharing: forMajor.no_sharing_categories || dc.no_sharing_categories || [],
  };
}

/** True when a category path is, or sits under, one of the category ids. */
function pathInCategories(path, ids) {
  if (!path || !ids || !ids.length) return false;
  return String(path).split('---').some(seg => ids.includes(seg));
}

/**
 * The limit in plain English for a minor header. `whose` is "your" for a
 * student and "the student's" for everyone else.
 */
function minorDoubleCountLimitText(def, majorCode, whose) {
  const who = whose || 'your';
  const rules = minorDoubleCountRules(def, majorCode);
  if (!rules.known) return 'Confirm double counting with your advisor.';
  const names = ids => joinWithAnd(ids.map(id => minorCategoryName(def, id) || id));
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
 * Double counting for one minor. A marked course used for this minor is
 * shared when it also counts toward the student's major (a major requirement;
 * General Education overlap is free when the file says so) or is used by
 * another of the student's minors. Shared courses in a no_limit category are
 * free, in a no_sharing category they are not allowed, and the rest count
 * toward the limit.
 *
 * opts: { majorCode, majorKindOf(code), otherMinors: [{ name, assigned: Map }] }
 */
function checkMinorDoubleCounting(def, progress, opts) {
  const o = opts || {};
  const rules = minorDoubleCountRules(def, o.majorCode);
  const shared = [];
  for (const [code, path] of ((progress && progress.assigned) || new Map())) {
    const kind = o.majorKindOf ? o.majorKindOf(code) : null;
    const withMajor = kind === 'degree' || (kind === 'gened' && !rules.genEdExempt);
    const withMinors = (o.otherMinors || []).filter(m => m.assigned && m.assigned.has(code)).map(m => m.name);
    if (!withMajor && !withMinors.length) continue;
    const free = pathInCategories(path, rules.noLimit);
    const blocked = !free && pathInCategories(path, rules.noSharing);
    shared.push({ code, path, withMajor, withMinors, free, blocked });
  }
  shared.sort((a, b) => a.code.localeCompare(b.code));
  const counted = shared.filter(s => !s.free && !s.blocked);
  return {
    rules,
    limit: rules.limit,
    known: rules.known,
    shared,
    counted,
    blocked: shared.filter(s => s.blocked),
    over: rules.limit != null && counted.length > rules.limit,
  };
}

/** Warnings for a minor header, from checkMinorDoubleCounting. */
function minorDoubleCountWarnings(check, def, majorCode) {
  const out = [];
  if (!check) return out;
  const major = majorCode ? `your ${majorCode} major` : 'your major';
  if (check.over) {
    const n = check.counted.length;
    const codes = joinWithAnd(check.counted.map(s => s.code));
    const lim = check.limit;
    out.push(`${n} course${n === 1 ? '' : 's'} you marked ${n === 1 ? 'counts' : 'count'} toward this minor and toward ${major} or another minor (${codes}). `
      + (lim === 0 ? 'None may.' : `At most ${lim} may.`) + ' Ask your advisor which ones to use.');
  }
  for (const s of check.blocked) {
    const ids = String(s.path).split('---');
    const name = minorCategoryName(def, ids[ids.length - 1]) || ids[ids.length - 1];
    const others = [];
    if (s.withMajor) others.push(major);
    for (const m of s.withMinors) others.push(`your ${m} minor`);
    out.push(`${s.code} is used here for ${name}, which may not also count toward another program, and it also counts toward ${joinWithAnd(others)}. Use another course here or confirm with your advisor.`);
  }
  return out;
}

/** Version strings come from the official files; show their " - " separators as commas. */
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
