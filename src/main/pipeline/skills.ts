const SKILL_LEXICON: { skill: string; aliases: string[] }[] = [
  { skill: 'TypeScript', aliases: ['typescript', 'ts'] },
  { skill: 'JavaScript', aliases: ['javascript', 'js', 'es6', 'ecmascript'] },
  { skill: 'React', aliases: ['react', 'react.js', 'reactjs'] },
  { skill: 'Next.js', aliases: ['next.js', 'nextjs'] },
  { skill: 'Node.js', aliases: ['node.js', 'nodejs', 'node js'] },
  { skill: 'Python', aliases: ['python'] },
  { skill: 'Go', aliases: ['golang', 'go lang'] },
  { skill: 'Java', aliases: ['java'] },
  { skill: 'Kotlin', aliases: ['kotlin'] },
  { skill: 'Swift', aliases: ['swift'] },
  { skill: 'Rust', aliases: ['rust'] },
  { skill: 'C#', aliases: ['c#', '.net', 'dotnet', 'asp.net'] },
  { skill: 'C++', aliases: ['c++', 'cpp'] },
  { skill: 'Ruby', aliases: ['ruby', 'rails'] },
  { skill: 'PHP', aliases: ['php', 'laravel'] },
  { skill: 'Scala', aliases: ['scala'] },
  { skill: 'SQL', aliases: ['sql'] },
  { skill: 'PostgreSQL', aliases: ['postgresql', 'postgres'] },
  { skill: 'MySQL', aliases: ['mysql'] },
  { skill: 'MongoDB', aliases: ['mongodb', 'mongo'] },
  { skill: 'Redis', aliases: ['redis'] },
  { skill: 'Elasticsearch', aliases: ['elasticsearch', 'elastic search', 'opensearch'] },
  { skill: 'Kafka', aliases: ['kafka'] },
  { skill: 'RabbitMQ', aliases: ['rabbitmq'] },
  { skill: 'GraphQL', aliases: ['graphql'] },
  { skill: 'REST APIs', aliases: ['rest api', 'restful', 'rest apis'] },
  { skill: 'gRPC', aliases: ['grpc'] },
  { skill: 'AWS', aliases: ['aws', 'amazon web services', 'ec2', 's3', 'lambda', 'eks', 'ecs'] },
  { skill: 'Azure', aliases: ['azure'] },
  { skill: 'Google Cloud', aliases: ['gcp', 'google cloud', 'bigquery'] },
  { skill: 'Kubernetes', aliases: ['kubernetes', 'k8s'] },
  { skill: 'Docker', aliases: ['docker', 'containers'] },
  { skill: 'Terraform', aliases: ['terraform', 'opentofu'] },
  { skill: 'Ansible', aliases: ['ansible'] },
  { skill: 'Helm', aliases: ['helm'] },
  { skill: 'ArgoCD', aliases: ['argocd', 'argo cd'] },
  { skill: 'GitHub Actions', aliases: ['github actions'] },
  { skill: 'GitLab CI', aliases: ['gitlab ci', 'gitlab-ci'] },
  { skill: 'Jenkins', aliases: ['jenkins'] },
  { skill: 'CI/CD', aliases: ['ci/cd', 'cicd', 'continuous integration', 'continuous delivery'] },
  { skill: 'Linux', aliases: ['linux', 'unix', 'ubuntu', 'centos', 'rhel'] },
  { skill: 'Bash', aliases: ['bash', 'shell scripting'] },
  { skill: 'Prometheus', aliases: ['prometheus'] },
  { skill: 'Grafana', aliases: ['grafana'] },
  { skill: 'Datadog', aliases: ['datadog'] },
  { skill: 'OpenTelemetry', aliases: ['opentelemetry', 'otel'] },
  { skill: 'Observability', aliases: ['observability', 'monitoring', 'alerting'] },
  { skill: 'Postgres tuning', aliases: ['query optimization', 'index tuning', 'database tuning'] },
  { skill: 'Distributed systems', aliases: ['distributed systems', 'distributed computing'] },
  { skill: 'Microservices', aliases: ['microservices'] },
  { skill: 'System design', aliases: ['system design', 'architecture design'] },
  { skill: 'SRE', aliases: ['sre', 'site reliability'] },
  { skill: 'Incident response', aliases: ['incident response', 'on-call', 'on call'] },
  { skill: 'Security', aliases: ['security', 'appsec', 'application security', 'infosec'] },
  { skill: 'OAuth', aliases: ['oauth', 'oidc', 'saml', 'sso'] },
  { skill: 'Machine Learning', aliases: ['machine learning', 'ml', 'deep learning'] },
  { skill: 'LLMs', aliases: ['llm', 'large language model', 'generative ai', 'genai'] },
  { skill: 'PyTorch', aliases: ['pytorch'] },
  { skill: 'TensorFlow', aliases: ['tensorflow'] },
  { skill: 'Pandas', aliases: ['pandas', 'numpy'] },
  { skill: 'Spark', aliases: ['spark', 'pyspark'] },
  { skill: 'Airflow', aliases: ['airflow'] },
  { skill: 'dbt', aliases: ['dbt'] },
  { skill: 'ETL', aliases: ['etl', 'elt', 'data pipeline'] },
  { skill: 'Data warehousing', aliases: ['data warehouse', 'snowflake', 'redshift', 'databricks'] },
  { skill: 'Product management', aliases: ['product management', 'product manager'] },
  { skill: 'Project management', aliases: ['project management', 'pmp', 'agile', 'scrum', 'kanban'] },
  { skill: 'Stakeholder management', aliases: ['stakeholder management'] },
  { skill: 'Technical writing', aliases: ['technical writing', 'documentation'] },
  { skill: 'Figma', aliases: ['figma'] },
  { skill: 'UI/UX', aliases: ['ui/ux', 'ux design', 'user experience', 'user interface'] },
  { skill: 'Accessibility', aliases: ['accessibility', 'wcag', 'a11y'] },
  { skill: 'HTML', aliases: ['html', 'html5'] },
  { skill: 'CSS', aliases: ['css', 'css3', 'tailwind'] },
  { skill: 'Vue', aliases: ['vue', 'vue.js', 'vuejs'] },
  { skill: 'Angular', aliases: ['angular'] },
  { skill: 'Svelte', aliases: ['svelte', 'sveltekit'] },
  { skill: 'Electron', aliases: ['electron'] },
  { skill: 'React Native', aliases: ['react native'] },
  { skill: 'Flutter', aliases: ['flutter'] },
  { skill: 'iOS', aliases: ['ios', 'swiftui', 'uikit'] },
  { skill: 'Android', aliases: ['android', 'jetpack compose'] },
  { skill: 'Playwright', aliases: ['playwright', 'cypress', 'selenium', 'puppeteer'] },
  { skill: 'Testing', aliases: ['unit testing', 'integration testing', 'test automation', 'e2e testing', 'tdd'] },
  { skill: 'Salesforce', aliases: ['salesforce', 'hubspot', 'crm'] },
  { skill: 'Excel', aliases: ['excel', 'spreadsheets', 'google sheets'] },
  { skill: 'Tableau', aliases: ['tableau', 'power bi', 'looker'] },
  { skill: 'SEO', aliases: ['seo', 'search engine optimization'] },
  { skill: 'Marketing', aliases: ['marketing', 'growth', 'paid ads', 'content marketing'] },
  { skill: 'Sales', aliases: ['sales', 'business development', 'account executive'] },
  { skill: 'Customer support', aliases: ['customer support', 'customer success', 'help desk'] },
  { skill: 'Finance', aliases: ['finance', 'accounting', 'fp&a'] },
  { skill: 'HR', aliases: ['human resources', 'recruiting', 'talent acquisition'] },
  { skill: 'Legal', aliases: ['legal', 'compliance', 'gdpr'] },
  { skill: 'Supply chain', aliases: ['supply chain', 'logistics', 'procurement'] },
  { skill: 'Healthcare', aliases: ['healthcare', 'clinical', 'hipaa'] },
  { skill: 'Networking', aliases: ['networking', 'tcp/ip', 'dns', 'bgp', 'vpn', 'load balancing'] },
  { skill: 'FinOps', aliases: ['finops', 'cloud cost', 'cost optimization'] },
  { skill: 'DevSecOps', aliases: ['devsecops', 'security automation'] },
  { skill: 'Cloud security', aliases: ['cloud security', 'security posture', 'iam security'] },
  { skill: 'MLOps', aliases: ['mlops', 'model deployment', 'model monitoring'] },
  { skill: 'Data modeling', aliases: ['data modeling', 'data modelling', 'dimensional modeling'] },
  { skill: 'Statistics', aliases: ['statistics', 'statistical modeling', 'a/b testing'] },
  { skill: 'Data analysis', aliases: ['data analysis', 'data analytics'] },
  { skill: 'Roadmapping', aliases: ['roadmap', 'roadmapping'] },
  { skill: 'Engineering leadership', aliases: ['engineering leadership', 'engineering manager', 'people management', 'team leadership', 'head of engineering'] },
  { skill: 'Hiring', aliases: ['hiring', 'technical recruiting', 'interviewing'] },
  { skill: 'Design systems', aliases: ['design system', 'design systems', 'component library'] },
  { skill: 'Git', aliases: ['git', 'version control'] },
  { skill: 'Markdown', aliases: ['markdown'] }
]

const COMPILED = SKILL_LEXICON.map((entry) => ({
  skill: entry.skill,
  patterns: entry.aliases.map((alias) => new RegExp(`(?<![a-z0-9+#])${escapeRegExp(alias)}(?![a-z0-9+#])`, 'i'))
}))

const SKILL_BY_ALIAS = new Map<string, string>()
for (const entry of SKILL_LEXICON) {
  SKILL_BY_ALIAS.set(entry.skill.toLowerCase(), entry.skill)
  for (const alias of entry.aliases) SKILL_BY_ALIAS.set(alias.toLowerCase(), entry.skill)
}

export function canonicalSkill(value: string): string | null {
  const normalized = value.trim().toLowerCase().replace(/[.;]+$/, '')
  return SKILL_BY_ALIAS.get(normalized) ?? null
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function extractSkills(text: string, limit = 30): string[] {
  if (!text) return []
  const found: string[] = []
  for (const entry of COMPILED) {
    if (found.length >= limit) break
    if (entry.patterns.some((pattern) => pattern.test(text))) found.push(entry.skill)
  }
  return found
}

export function extractSeniority(title: string, description = ''): string | null {
  const haystack = `${title} ${description.slice(0, 3000)}`.toLowerCase()
  const levels: { level: string; pattern: RegExp }[] = [
    { level: 'internship', pattern: /\bintern(ship)?\b/ },
    { level: 'junior', pattern: /\b(junior|jr\.?|entry[- ]level|graduate)\b/ },
    { level: 'mid', pattern: /\b(mid[- ]level|intermediate)\b/ },
    { level: 'senior', pattern: /\b(senior|sr\.?)\b/ },
    { level: 'staff', pattern: /\bstaff\b/ },
    { level: 'principal', pattern: /\bprincipal\b/ },
    { level: 'lead', pattern: /\b(lead|team lead|tech lead)\b/ },
    { level: 'manager', pattern: /\b(engineering manager|manager)\b/ },
    { level: 'director', pattern: /\bdirector\b/ },
    { level: 'executive', pattern: /\b(vp|vice president|head of|chief|cto|ceo|coo)\b/ }
  ]
  for (const level of levels) if (level.pattern.test(haystack)) return level.level
  return null
}
