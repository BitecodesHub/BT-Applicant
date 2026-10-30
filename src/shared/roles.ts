export interface RoleDefinition {
  key: string
  title: string
  family: string
  description: string
  titleAliases: string[]
  coreSkills: string[]
  bonusSkills: string[]
  certifications: string[]
  minYears: number
  idealYears: number
}

/**
 * Roles are decision support, not a job taxonomy. Aliases are also used as
 * discovery titles, so keep them close to how employers write the role.
 */
export const ROLE_CATALOG: RoleDefinition[] = [
  {
    key: 'platform_engineer',
    title: 'Platform Engineer',
    family: 'Cloud & operations',
    description: 'Builds the self-service infrastructure and tooling other engineers ship on.',
    titleAliases: ['Platform Engineer', 'Platform Engineering', 'Infrastructure Platform Engineer', 'Developer Experience Engineer', 'DevEx Engineer', 'Internal Tools Engineer'],
    coreSkills: ['Kubernetes', 'Docker', 'Terraform', 'AWS', 'Linux', 'CI/CD', 'GitHub Actions', 'Observability', 'Go', 'Python', 'Helm', 'ArgoCD'],
    bonusSkills: ['Networking', 'FinOps', 'Security', 'PostgreSQL'],
    certifications: ['CKA', 'CKAD', 'AWS Certified Solutions Architect', 'HashiCorp Terraform Associate'],
    minYears: 2,
    idealYears: 5
  },
  {
    key: 'devops_engineer',
    title: 'DevOps Engineer',
    family: 'Cloud & operations',
    description: 'Automates build, release, and infrastructure operations across environments.',
    titleAliases: ['DevOps Engineer', 'Cloud DevOps Engineer', 'Infrastructure Engineer', 'Build and Release Engineer', 'Automation Engineer'],
    coreSkills: ['CI/CD', 'Terraform', 'Kubernetes', 'Docker', 'AWS', 'Linux', 'Bash', 'Ansible', 'Jenkins', 'Prometheus', 'Grafana', 'GitLab CI'],
    bonusSkills: ['Networking', 'FinOps', 'Security', 'ArgoCD'],
    certifications: ['AWS Certified DevOps Engineer', 'CKA', 'HashiCorp Terraform Associate', 'Azure Administrator'],
    minYears: 2,
    idealYears: 5
  },
  {
    key: 'site_reliability_engineer',
    title: 'Site Reliability Engineer',
    family: 'Cloud & operations',
    description: 'Keeps production reliable through service levels, automation, and incident response.',
    titleAliases: ['Site Reliability Engineer', 'SRE', 'Reliability Engineer', 'Production Engineer'],
    coreSkills: ['SRE', 'Kubernetes', 'Prometheus', 'Grafana', 'Linux', 'Incident response', 'Observability', 'Go', 'Python', 'OpenTelemetry', 'Terraform', 'AWS'],
    bonusSkills: ['Networking', 'Distributed systems', 'Security', 'CI/CD'],
    certifications: ['CKA', 'Prometheus Certified Associate', 'AWS Certified Solutions Architect'],
    minYears: 3,
    idealYears: 6
  },
  {
    key: 'cloud_engineer',
    title: 'Cloud Engineer',
    family: 'Cloud & operations',
    description: 'Designs and operates cloud accounts, networks, and managed services.',
    titleAliases: ['Cloud Engineer', 'Cloud Infrastructure Engineer', 'AWS Engineer', 'Azure Engineer', 'Google Cloud Engineer'],
    coreSkills: ['AWS', 'Azure', 'Google Cloud', 'Terraform', 'Linux', 'Docker', 'Kubernetes', 'CI/CD', 'Networking', 'FinOps', 'Security'],
    bonusSkills: ['Python', 'Bash', 'Observability', 'PostgreSQL'],
    certifications: ['AWS Certified Solutions Architect', 'Azure Administrator', 'Google Cloud Professional Cloud Architect', 'HashiCorp Terraform Associate'],
    minYears: 2,
    idealYears: 5
  },
  {
    key: 'backend_engineer',
    title: 'Backend Engineer',
    family: 'Engineering',
    description: 'Builds APIs, services, and data flows behind the product.',
    titleAliases: ['Backend Engineer', 'Backend Software Engineer', 'Server Engineer', 'API Engineer'],
    coreSkills: ['TypeScript', 'Node.js', 'Python', 'Java', 'Go', 'SQL', 'PostgreSQL', 'REST APIs', 'GraphQL', 'Redis', 'Microservices', 'Docker'],
    bonusSkills: ['Kafka', 'AWS', 'System design', 'Testing'],
    certifications: ['AWS Certified Developer', 'Oracle Certified Professional Java'],
    minYears: 2,
    idealYears: 5
  },
  {
    key: 'frontend_engineer',
    title: 'Frontend Engineer',
    family: 'Engineering',
    description: 'Builds accessible, responsive product interfaces and design systems.',
    titleAliases: ['Frontend Engineer', 'Frontend Developer', 'UI Engineer', 'Web Engineer'],
    coreSkills: ['React', 'TypeScript', 'JavaScript', 'CSS', 'HTML', 'Next.js', 'Accessibility', 'Testing', 'Figma', 'Design systems'],
    bonusSkills: ['Vue', 'Angular', 'Svelte', 'Node.js'],
    certifications: [],
    minYears: 2,
    idealYears: 5
  },
  {
    key: 'full_stack_engineer',
    title: 'Full Stack Engineer',
    family: 'Engineering',
    description: 'Ships product features across the interface, API, and database.',
    titleAliases: ['Full Stack Engineer', 'Fullstack Engineer', 'Full Stack Developer', 'Fullstack Developer'],
    coreSkills: ['TypeScript', 'React', 'Node.js', 'SQL', 'PostgreSQL', 'REST APIs', 'AWS', 'Docker', 'Next.js', 'Testing'],
    bonusSkills: ['GraphQL', 'Redis', 'Kubernetes', 'CI/CD'],
    certifications: ['AWS Certified Developer'],
    minYears: 2,
    idealYears: 5
  },
  {
    key: 'software_engineer',
    title: 'Software Engineer',
    family: 'Engineering',
    description: 'General product engineering with a focus on maintainable software.',
    titleAliases: ['Software Engineer', 'Software Developer', 'Application Engineer', 'Product Engineer'],
    coreSkills: ['TypeScript', 'Python', 'Java', 'Go', 'SQL', 'REST APIs', 'Testing', 'Git', 'Docker', 'System design'],
    bonusSkills: ['React', 'AWS', 'PostgreSQL', 'CI/CD'],
    certifications: [],
    minYears: 0,
    idealYears: 4
  },
  {
    key: 'mobile_engineer',
    title: 'Mobile Engineer',
    family: 'Engineering',
    description: 'Builds and releases native or cross-platform mobile applications.',
    titleAliases: ['Mobile Engineer', 'iOS Engineer', 'Android Engineer', 'Mobile Developer', 'React Native Engineer'],
    coreSkills: ['Swift', 'iOS', 'Kotlin', 'Android', 'React Native', 'Flutter', 'TypeScript', 'Testing'],
    bonusSkills: ['Node.js', 'REST APIs', 'Accessibility', 'CI/CD'],
    certifications: ['Apple Certified iOS Developer', 'Google Associate Android Developer'],
    minYears: 2,
    idealYears: 5
  },
  {
    key: 'data_engineer',
    title: 'Data Engineer',
    family: 'Data & AI',
    description: 'Builds reliable pipelines, models, and warehouse foundations for analytics.',
    titleAliases: ['Data Engineer', 'Analytics Engineer', 'Data Platform Engineer', 'ETL Engineer'],
    coreSkills: ['Python', 'SQL', 'ETL', 'Airflow', 'dbt', 'Spark', 'Data warehousing', 'Kafka', 'AWS', 'Data modeling'],
    bonusSkills: ['Kubernetes', 'Docker', 'Terraform', 'Statistics'],
    certifications: ['Google Cloud Professional Data Engineer', 'Databricks Certified Data Engineer', 'AWS Certified Data Engineer'],
    minYears: 2,
    idealYears: 5
  },
  {
    key: 'data_scientist',
    title: 'Data Scientist',
    family: 'Data & AI',
    description: 'Turns data into models, experiments, and measurable product decisions.',
    titleAliases: ['Data Scientist', 'Applied Scientist', 'Machine Learning Scientist', 'Decision Scientist'],
    coreSkills: ['Python', 'Pandas', 'Machine Learning', 'SQL', 'Statistics', 'Spark', 'PyTorch', 'TensorFlow', 'Data analysis', 'LLMs'],
    bonusSkills: ['Data warehousing', 'Data modeling', 'Airflow', 'dbt'],
    certifications: ['AWS Certified Machine Learning', 'TensorFlow Developer'],
    minYears: 2,
    idealYears: 5
  },
  {
    key: 'ml_engineer',
    title: 'Machine Learning Engineer',
    family: 'Data & AI',
    description: 'Takes models into production with reliable training, serving, and monitoring.',
    titleAliases: ['Machine Learning Engineer', 'ML Engineer', 'MLOps Engineer', 'AI Engineer', 'LLM Engineer'],
    coreSkills: ['Python', 'PyTorch', 'TensorFlow', 'Machine Learning', 'LLMs', 'MLOps', 'Docker', 'Kubernetes', 'AWS', 'Spark'],
    bonusSkills: ['Terraform', 'Kafka', 'Data modeling', 'Statistics'],
    certifications: ['AWS Certified Machine Learning', 'TensorFlow Developer'],
    minYears: 2,
    idealYears: 5
  },
  {
    key: 'security_engineer',
    title: 'Security Engineer',
    family: 'Security',
    description: 'Reduces security risk in applications, cloud infrastructure, and delivery.',
    titleAliases: ['Security Engineer', 'Application Security Engineer', 'Cloud Security Engineer', 'DevSecOps Engineer', 'Product Security Engineer'],
    coreSkills: ['Security', 'Cloud security', 'DevSecOps', 'OAuth', 'Linux', 'AWS', 'Kubernetes', 'Python', 'Incident response', 'Networking'],
    bonusSkills: ['Terraform', 'Docker', 'CI/CD', 'Go'],
    certifications: ['CISSP', 'CCSP', 'AWS Security Specialty', 'OSCP'],
    minYears: 2,
    idealYears: 6
  },
  {
    key: 'qa_engineer',
    title: 'QA Engineer',
    family: 'Quality & support',
    description: 'Prevents regressions through test strategy, automation, and release gates.',
    titleAliases: ['QA Engineer', 'Quality Engineer', 'SDET', 'Test Automation Engineer', 'Software Development Engineer in Test'],
    coreSkills: ['Testing', 'Playwright', 'JavaScript', 'TypeScript', 'Python', 'CI/CD', 'Accessibility', 'Git'],
    bonusSkills: ['Docker', 'REST APIs', 'Security', 'Observability'],
    certifications: ['ISTQB Certified Tester'],
    minYears: 1,
    idealYears: 4
  },
  {
    key: 'engineering_manager',
    title: 'Engineering Manager',
    family: 'Leadership',
    description: 'Leads engineers and owns delivery, hiring, and technical direction.',
    titleAliases: ['Engineering Manager', 'Software Engineering Manager', 'Head of Engineering', 'Director of Engineering'],
    coreSkills: ['Engineering leadership', 'Hiring', 'Project management', 'Stakeholder management', 'System design', 'Roadmapping', 'CI/CD', 'Technical writing'],
    bonusSkills: ['Security', 'Kubernetes', 'AWS', 'Product management'],
    certifications: ['PMP', 'Certified Scrum Master'],
    minYears: 6,
    idealYears: 10
  },
  {
    key: 'product_manager',
    title: 'Product Manager',
    family: 'Product & design',
    description: 'Defines product outcomes and coordinates discovery, delivery, and measurement.',
    titleAliases: ['Product Manager', 'Technical Product Manager', 'Product Owner', 'Product Lead'],
    coreSkills: ['Product management', 'Roadmapping', 'Stakeholder management', 'Data analysis', 'Technical writing', 'Project management', 'Figma', 'Statistics'],
    bonusSkills: ['SQL', 'Marketing', 'Sales', 'UX/UI'],
    certifications: ['Certified Scrum Product Owner', 'PMP'],
    minYears: 2,
    idealYears: 5
  },
  {
    key: 'product_designer',
    title: 'Product Designer',
    family: 'Product & design',
    description: 'Designs usable product flows, interfaces, and design systems.',
    titleAliases: ['Product Designer', 'UX Designer', 'UI Designer', 'UX/UI Designer', 'Interaction Designer'],
    coreSkills: ['UI/UX', 'Figma', 'Accessibility', 'Design systems', 'HTML', 'CSS', 'Technical writing'],
    bonusSkills: ['React', 'Marketing', 'Data analysis'],
    certifications: ['NN/g UX Certification'],
    minYears: 1,
    idealYears: 5
  },
  {
    key: 'technical_writer',
    title: 'Technical Writer',
    family: 'Quality & support',
    description: 'Turns complex systems into accurate guides, references, and release notes.',
    titleAliases: ['Technical Writer', 'Documentation Engineer', 'Information Developer', 'Content Engineer'],
    coreSkills: ['Technical writing', 'Markdown', 'Git', 'HTML', 'CSS', 'Accessibility', 'Security'],
    bonusSkills: ['React', 'Python', 'CI/CD', 'Product management'],
    certifications: [],
    minYears: 1,
    idealYears: 4
  },
  {
    key: 'business_analyst',
    title: 'Business Analyst',
    family: 'Product & design',
    description: 'Translates business needs into requirements, data, and measurable improvements.',
    titleAliases: ['Business Analyst', 'Systems Analyst', 'Data Analyst', 'Product Analyst'],
    coreSkills: ['Data analysis', 'SQL', 'Excel', 'Tableau', 'Stakeholder management', 'Project management', 'Data modeling', 'Statistics'],
    bonusSkills: ['Product management', 'Technical writing', 'Python'],
    certifications: ['CBAP', 'PMP', 'IIBA Certification'],
    minYears: 1,
    idealYears: 4
  },
  {
    key: 'support_engineer',
    title: 'Support Engineer',
    family: 'Quality & support',
    description: 'Resolves customer-facing technical issues and feeds fixes back to engineering.',
    titleAliases: ['Support Engineer', 'Technical Support Engineer', 'Customer Support Engineer', 'Customer Success Engineer', 'Solutions Engineer'],
    coreSkills: ['Customer support', 'Linux', 'SQL', 'Technical writing', 'Incident response', 'Networking', 'Security'],
    bonusSkills: ['Python', 'Bash', 'AWS', 'Kubernetes'],
    certifications: ['ITIL Foundation', 'AWS Cloud Practitioner'],
    minYears: 0,
    idealYears: 3
  }
]

export const ROLE_BY_KEY = new Map(ROLE_CATALOG.map((role) => [role.key, role]))

export const MAX_SELECTED_ROLES = 8

export function roleDefinition(key: string): RoleDefinition | undefined {
  return ROLE_BY_KEY.get(key)
}
