/**
 * Simplified, recognizable brand marks (in each brand's colors) for the
 * integrations / connected-apps directory. Rendered inline as SVG so they
 * stay crisp and need no network requests.
 */
export type BrandKey =
  | "slack"
  | "google-drive"
  | "github"
  | "salesforce"
  | "zapier"
  | "google-calendar";

export function BrandLogo({ brand, size = 26 }: { brand: BrandKey; size?: number }) {
  const common = { width: size, height: size, viewBox: "0 0 48 48", xmlns: "http://www.w3.org/2000/svg" } as const;

  switch (brand) {
    case "slack":
      // 4-colour pinwheel of rounded bars  -  Slack's identity colours.
      return (
        <svg {...common} aria-label="Slack">
          <rect x="22" y="5" width="6" height="16" rx="3" fill="#36C5F0" />
          <rect x="27" y="22" width="16" height="6" rx="3" fill="#2EB67D" />
          <rect x="20" y="27" width="6" height="16" rx="3" fill="#ECB22E" />
          <rect x="5" y="20" width="16" height="6" rx="3" fill="#E01E5A" />
        </svg>
      );
    case "google-drive":
      // Tri-colour triangle evoking the Drive mark.
      return (
        <svg {...common} aria-label="Google Drive">
          <polygon points="24,9 40,37 8,37" fill="#4285F4" />
          <polygon points="24,9 32,25 16,25" fill="#FFBA00" />
          <polygon points="24,25 40,37 24,37" fill="#0F9D58" />
        </svg>
      );
    case "github":
      return (
        <svg {...common} aria-label="GitHub">
          <path
            fill="currentColor"
            d="M24 4C13 4 4 13 4 24c0 8.8 5.7 16.3 13.7 19 1 .2 1.4-.4 1.4-1v-3.4c-5.6 1.2-6.8-2.7-6.8-2.7-.9-2.3-2.2-3-2.2-3-1.8-1.3.1-1.2.1-1.2 2 .1 3.1 2.1 3.1 2.1 1.8 3.1 4.7 2.2 5.8 1.7.2-1.3.7-2.2 1.3-2.7-4.5-.5-9.2-2.3-9.2-10 0-2.2.8-4 2.1-5.4-.2-.5-.9-2.6.2-5.3 0 0 1.7-.6 5.5 2.1a19 19 0 0 1 10 0c3.8-2.7 5.5-2.1 5.5-2.1 1.1 2.7.4 4.8.2 5.3a7.7 7.7 0 0 1 2.1 5.4c0 7.7-4.7 9.4-9.2 9.9.7.6 1.4 1.9 1.4 3.8V42c0 .6.4 1.2 1.4 1C38.3 40.3 44 32.8 44 24 44 13 35 4 24 4Z"
          />
        </svg>
      );
    case "salesforce":
      return (
        <svg {...common} aria-label="Salesforce">
          <path
            fill="#00A1E0"
            d="M20 15a7 7 0 0 1 12 2 8 8 0 0 1 3-.6 8 8 0 0 1 .6 16H15a9 9 0 0 1-1.6-17.8A7 7 0 0 1 20 15Z"
          />
        </svg>
      );
    case "zapier":
      return (
        <svg {...common} aria-label="Zapier">
          <path
            fill="#FF4F00"
            d="M30 24c0 1.7-.3 3.4-.9 4.9-1.5.6-3.2.9-4.9.9h-.4c-1.7 0-3.4-.3-4.9-.9-.6-1.5-.9-3.2-.9-4.9s.3-3.4.9-4.9c1.5-.6 3.2-.9 4.9-.9h.4c1.7 0 3.4.3 4.9.9.6 1.5.9 3.2.9 4.9Zm14-3h-9.9l7-7-4.2-4.2-7 7V4h-6v9.8l-7-7L6.7 11l7 7H4v6h9.8l-7 7 4.2 4.2 7-7V44h6v-9.9l7 7 4.2-4.2-7-7H44v-6Z"
          />
        </svg>
      );
    case "google-calendar":
      return (
        <svg {...common} aria-label="Google Calendar">
          <rect x="9" y="9" width="30" height="30" rx="4" fill="#fff" />
          <path fill="#4285F4" d="M9 13a4 4 0 0 1 4-4h22v8H9v-4Z" />
          <path fill="#EA4335" d="M9 35a4 4 0 0 0 4 4h4v-8H9v4Z" />
          <path fill="#34A853" d="M31 39h4a4 4 0 0 0 4-4v-4h-8v8Z" />
          <path fill="#FBBC04" d="M39 17h-8v14h8V17Z" />
          <text x="24" y="30" textAnchor="middle" fontSize="13" fontWeight="700" fill="#4285F4" fontFamily="Arial, sans-serif">
            31
          </text>
        </svg>
      );
    default:
      return null;
  }
}
