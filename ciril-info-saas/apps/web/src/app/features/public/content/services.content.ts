// Service pages content. Copied from the approved design reference. General descriptions of
// what each service is; no prices, results or client claims.
export interface ServiceContent {
  slug: string;
  name: string;
  /** Contact-form value for "?service=" */
  formService: string;
  /** Detail-page H1 */
  headline: string;
  /** One-line summary (home, detail hero, related cards) */
  tagline: string;
  /** Longer intro (services list, detail overview) */
  overview: string;
  exploreLabel: string;
  features: { title: string; text: string }[];
  benefits: { title: string; text: string }[];
  useCases: { title: string; text: string }[];
  process: { title: string; text: string }[];
  faqs: { question: string; answer: string }[];
}

export const SERVICES: ServiceContent[] = [
  {
    slug: "web-design",
    name: "Web Design",
    formService: "Web Design",
    headline: "Website Design",
    tagline: "Beautiful, intuitive, and conversion-focused website designs that bring your brand to life.",
    overview: "Your website is often the first conversation a customer has with your business. We design interfaces that are clear, memorable and built around the action you want visitors to take.",
    exploreLabel: "Explore Web Design",
    features: [{ title: "UI/UX Design", text: "Wireframes, flows and interfaces that feel natural to use." }, { title: "Responsive Web Design", text: "Layouts that adapt from large desktops to small phones." }, { title: "Landing Page Design", text: "Focused single-purpose pages for campaigns, launches and lead capture." }, { title: "Website Redesign", text: "Refresh an outdated site while keeping what already works." }, { title: "Brand-focused Visual Design", text: "Typography, colour and imagery that express your brand consistently." }],
    benefits: [{ title: "Clarity that converts", text: "Structured layouts and focused calls to action guide visitors toward enquiring, booking or buying." }, { title: "A look that is yours", text: "Visual design built from your brand, so your site never feels like a generic template." }, { title: "Comfortable on every screen", text: "Responsive layouts are designed for phones, tablets and desktops from the first sketch." }, { title: "Easy to extend", text: "Reusable design components keep future pages fast to produce and visually consistent." }],
    useCases: [{ title: "Service businesses", text: "Present what you offer clearly and make it easy to get in touch." }, { title: "New ventures", text: "Launch a credible first website that can grow with the business." }, { title: "Outdated websites", text: "Modernise the look and structure without losing your existing audience." }, { title: "Campaigns and launches", text: "Give a promotion or product its own focused landing page." }],
    process: [{ title: "Discover", text: "Goals, audience, content and competitors reviewed." }, { title: "Strategize", text: "Sitemap, wireframes and messaging agreed with you." }, { title: "Create", text: "Visual design and an interactive prototype to review." }, { title: "Grow", text: "Hand-off to development and refinement after launch." }],
    faqs: [{ question: "What do I need to provide?", answer: "Your goals, any existing brand assets and the content you want to feature. If your content is not ready, we can help shape the structure first." }, { question: "Do you redesign existing websites?", answer: "Yes. We review what already works, then redesign the experience, structure and visuals around your current goals." }, { question: "Will the design work on mobile?", answer: "Yes. Every design is created to work across screen sizes, not adapted as an afterthought." }],
  },
  {
    slug: "web-development",
    name: "Web Development",
    formService: "Web Development",
    headline: "Website Development",
    tagline: "Powerful, scalable, and high-performance websites built to deliver exceptional digital experiences.",
    overview: "We turn designs and ideas into fast, maintainable websites and online stores, built with performance, accessibility and search visibility in mind from the first line of code.",
    exploreLabel: "Explore Development",
    features: [{ title: "Custom Website Development", text: "Sites built to your requirements rather than forced into a template." }, { title: "Business Websites", text: "Professional multi-page sites that present your company and services." }, { title: "E-commerce Development", text: "Online stores with product catalogues, carts and checkout flows." }, { title: "CMS Development", text: "Content management so your team can update the site without a developer." }, { title: "Website Maintenance", text: "Updates, backups, fixes and improvements after launch." }],
    benefits: [{ title: "Built for speed", text: "Lean, optimised code and assets keep pages loading quickly." }, { title: "Simple to manage", text: "Content tools sized to your team, so routine updates do not need a developer." }, { title: "Ready to scale", text: "Clean architecture lets you add pages, features and integrations later." }, { title: "Accessible and search-friendly", text: "Semantic markup and sensible structure help people and search engines alike." }],
    useCases: [{ title: "Company websites", text: "A dependable home for your services, information and enquiries." }, { title: "Online stores", text: "Sell products with a catalogue, cart and checkout that customers trust." }, { title: "Content-led sites", text: "Publish and manage articles, case studies or resources with a CMS." }, { title: "Custom features", text: "Enquiry forms, booking flows and integrations tailored to your process." }],
    process: [{ title: "Discover", text: "Requirements, integrations and constraints captured." }, { title: "Strategize", text: "Architecture and technology chosen to fit the project." }, { title: "Create", text: "Development, testing and review in clear stages." }, { title: "Grow", text: "Launch, monitoring and ongoing maintenance." }],
    faqs: [{ question: "Which technologies do you use?", answer: "We choose technology to match your needs, from modern front-end frameworks to CMS and e-commerce platforms, instead of forcing one stack on every project." }, { question: "Can you work on my existing website?", answer: "Yes. We can review, fix, extend or migrate an existing site, and advise on whether a rebuild makes sense." }, { question: "Do you support the site after launch?", answer: "Yes. Website maintenance covers updates, backups, fixes and improvements so your site stays healthy." }],
  },
  {
    slug: "digital-marketing",
    name: "Digital Marketing",
    formService: "Digital Marketing",
    headline: "Digital Marketing",
    tagline: "Strategic digital marketing solutions that help your business reach the right audience and generate meaningful results.",
    overview: "Visibility is built, not bought overnight. We combine search, social, content and strategy so the right people find your business and understand why it is worth choosing.",
    exploreLabel: "Explore Marketing",
    features: [{ title: "SEO", text: "Technical, on-page and content work that improves how you appear in search." }, { title: "Social Media Marketing", text: "Consistent, on-brand presence across the channels your audience uses." }, { title: "Search Engine Marketing", text: "Paid search campaigns that put you in front of people ready to act." }, { title: "Content Marketing", text: "Useful articles, pages and assets that build trust and attract visitors." }, { title: "Marketing Strategy", text: "A clear plan that connects goals, audiences, channels and measurement." }],
    benefits: [{ title: "Reach the right audience", text: "Channels and messages are chosen around who you want to reach, not around trends." }, { title: "Measured, not guessed", text: "Tracking is set up so you can see what is working and adjust." }, { title: "A steady presence", text: "Planned content and posting keep your brand active and recognisable." }, { title: "Joined up with your website", text: "Marketing and web work together, so traffic lands on pages designed to convert." }],
    useCases: [{ title: "Being found online", text: "Improve visibility for the searches your customers already make." }, { title: "New launches", text: "Plan the channels and content that introduce a new business or offer." }, { title: "Sites with little traffic", text: "Diagnose why a good website is not reaching people, and fix it." }, { title: "Building authority", text: "Demonstrate expertise through consistent, helpful content." }],
    process: [{ title: "Discover", text: "Audience, competitors and current performance reviewed." }, { title: "Strategize", text: "Channels, messages, priorities and measures agreed." }, { title: "Create", text: "Content, campaigns and optimisations put into action." }, { title: "Grow", text: "Results reviewed and the plan refined over time." }],
    faqs: [{ question: "Can you guarantee search rankings?", answer: "No one can honestly guarantee rankings. We follow sound SEO practice, build useful content, measure results and are transparent about what we can and cannot influence." }, { question: "Which channels will you recommend?", answer: "It depends on your audience and goals. We recommend a focused mix rather than trying to be everywhere at once." }, { question: "How will I know it is working?", answer: "We agree what success looks like at the start and set up tracking so progress can be reviewed clearly." }],
  },
  {
    slug: "online-promotions",
    name: "Online Promotions",
    formService: "Online Promotions",
    headline: "Online Promotions",
    tagline: "Creative promotional campaigns that increase brand visibility, engagement, and customer acquisition.",
    overview: "When you have something to announce, sell or launch, a focused campaign gets it noticed. We plan, create and manage promotions that bring attention to your brand and turn it into enquiries.",
    exploreLabel: "Explore Promotions",
    features: [{ title: "Social Media Promotions", text: "Creative campaigns that spark engagement on social platforms." }, { title: "Paid Advertising Campaigns", text: "Targeted ads set up, tested and optimised for your goals." }, { title: "Online Brand Promotion", text: "Campaigns that raise awareness and make your brand easier to remember." }, { title: "Lead Generation", text: "Offers, landing pages and funnels designed to capture qualified enquiries." }, { title: "Campaign Management", text: "Planning, scheduling, monitoring and reporting handled for you." }],
    benefits: [{ title: "Noticed quickly", text: "Time-bound campaigns put a specific message in front of your audience." }, { title: "Targeted reach", text: "Audiences are defined so effort goes to people who are likely to care." }, { title: "Creative that fits", text: "Visuals and copy follow your brand, so every campaign feels like you." }, { title: "Managed end to end", text: "We handle planning, launch and reporting so you can focus on running the business." }],
    useCases: [{ title: "Launches", text: "Announce a new product, service or website with momentum." }, { title: "Seasonal offers", text: "Promote limited-time deals and campaigns around key dates." }, { title: "Events", text: "Drive registrations and attendance for events and webinars." }, { title: "Lead generation", text: "Collect enquiries for services that depend on conversations." }],
    process: [{ title: "Discover", text: "Campaign goal, offer and audience defined." }, { title: "Strategize", text: "Channels, creative direction and budget agreed with you." }, { title: "Create", text: "Creative produced and campaigns launched." }, { title: "Grow", text: "Performance monitored and campaigns optimised." }],
    faqs: [{ question: "How is this different from digital marketing?", answer: "Digital marketing builds long-term foundations such as search visibility and content. Promotions are focused campaigns that drive attention and enquiries around a specific goal or moment." }, { question: "Who decides the ad budget?", answer: "We agree the advertising budget with you before any paid campaign launches, and report on how it is used." }, { question: "Do you create the ad creative?", answer: "Yes. Creative direction, visuals and copy are part of campaign planning, built on your brand." }],
  },
  {
    slug: "domain-services",
    name: "Domain Services",
    formService: "Domain Services",
    headline: "Domain Services",
    tagline: "Get your business online with reliable domain registration and domain management services.",
    overview: "Your domain is your address on the internet. We help you choose the right name, register it, keep it renewed and connect it correctly to your website and email.",
    exploreLabel: "Explore Domain Services",
    features: [{ title: "Domain Registration", text: "Secure the right domain name for your business." }, { title: "Domain Renewal", text: "Renewals tracked so your domain does not lapse by accident." }, { title: "Domain Transfer", text: "Move a domain to a new provider with minimal disruption." }, { title: "DNS Management", text: "Configure records so your site, email and services work together." }, { title: "Business Domain Consultation", text: "Advice on naming, extensions and protecting your brand online." }],
    benefits: [{ title: "The right name first", text: "Guidance on choosing a domain that is short, memorable and easy to spell." }, { title: "Nothing lapses unnoticed", text: "Renewal tracking reduces the risk of losing a domain you depend on." }, { title: "Smooth transitions", text: "Transfers are planned so your website and email keep working." }, { title: "Correctly connected", text: "DNS is configured so your domain points to the right services." }],
    useCases: [{ title: "New business names", text: "Find and register a domain that fits your brand." }, { title: "Changing provider", text: "Transfer a domain you already own without breaking your site." }, { title: "Connecting services", text: "Point your domain at your website, email and other tools." }, { title: "Managing several domains", text: "Keep multiple brand or product domains organised in one place." }],
    process: [{ title: "Discover", text: "Your brand, name ideas and current setup reviewed." }, { title: "Strategize", text: "Domain options and extensions recommended." }, { title: "Create", text: "Registration, transfer and DNS set up." }, { title: "Grow", text: "Renewals tracked and settings kept current." }],
    faqs: [{ question: "Can you transfer my existing domain?", answer: "Yes, domain transfer is part of our domain services. Eligibility depends on your current provider and the type of domain." }, { question: "What is DNS management?", answer: "DNS records tell the internet where your website and email live. We configure and maintain them so everything keeps working together." }, { question: "How do I choose a good domain name?", answer: "Short, memorable and easy to spell and say aloud. Our consultation helps you compare options and extensions." }],
  },
]; 

export const SERVICE_BY_SLUG = new Map(SERVICES.map((s) => [s.slug, s]));

export const PROCESS_STEPS = [
  { title: 'Discover', text: 'Understand the business, goals, and requirements.' },
  { title: 'Strategize', text: 'Develop the right digital strategy and solution.' },
  { title: 'Create', text: 'Design, develop, and implement the solution.' },
  { title: 'Grow', text: 'Launch, promote, optimize, and support digital growth.' },
];
