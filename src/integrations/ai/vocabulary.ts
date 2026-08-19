/**
 * The AI contract's shared vocabulary: the closed set of intents a provider may
 * return, and the extraction schemas it may be asked to fill.
 *
 * It lives here (rather than in core) so the integrations layer stays a leaf
 * with no dependencies on business logic — swapping OpenAI for another model
 * means implementing `AiProvider` against this file and nothing else.
 *
 * Adding an intent: add it here, then decide what the CRM should do about it in
 * src/core/workflows/rules.ts. The two are deliberately separate — the model
 * describes, the rules decide.
 */

export const INTENTS = {
  QUOTE_REQUEST: 'quote_request',
  PROVIDING_INFORMATION: 'providing_information',
  PRICE_OBJECTION: 'price_objection',
  REQUESTING_ALTERNATIVE_QUOTE: 'requesting_alternative_quote',
  WANTS_TO_PROCEED: 'wants_to_proceed',
  READY_TO_BIND: 'ready_to_bind',
  SENDING_DOCUMENTS: 'sending_documents',
  ASKING_QUESTION: 'asking_question',
  REQUESTING_FOLLOW_UP: 'requesting_follow_up',
  NOT_INTERESTED: 'not_interested',
  PURCHASED_ELSEWHERE: 'purchased_elsewhere',
  CHANGE_INFORMATION: 'change_information',
  NEEDS_ASSISTANCE: 'needs_assistance',
  GREETING: 'greeting',
  COMPLAINT: 'complaint',
  PAYMENT_QUESTION: 'payment_question',
  RENEWAL_ENQUIRY: 'renewal_enquiry',
  UNKNOWN: 'unknown',
} as const;

export type Intent = (typeof INTENTS)[keyof typeof INTENTS];

export const INTENT_LIST: Intent[] = Object.values(INTENTS);

export const INTENT_LABELS: Record<Intent, string> = {
  [INTENTS.QUOTE_REQUEST]: 'Wants a quote',
  [INTENTS.PROVIDING_INFORMATION]: 'Providing information',
  [INTENTS.PRICE_OBJECTION]: 'Price objection',
  [INTENTS.REQUESTING_ALTERNATIVE_QUOTE]: 'Wants another quote',
  [INTENTS.WANTS_TO_PROCEED]: 'Wants to proceed',
  [INTENTS.READY_TO_BIND]: 'Ready to bind',
  [INTENTS.SENDING_DOCUMENTS]: 'Sending documents',
  [INTENTS.ASKING_QUESTION]: 'Asking a question',
  [INTENTS.REQUESTING_FOLLOW_UP]: 'Wants a follow-up',
  [INTENTS.NOT_INTERESTED]: 'Not interested',
  [INTENTS.PURCHASED_ELSEWHERE]: 'Bought elsewhere',
  [INTENTS.CHANGE_INFORMATION]: 'Wants to change information',
  [INTENTS.NEEDS_ASSISTANCE]: 'Needs assistance',
  [INTENTS.GREETING]: 'Greeting',
  [INTENTS.COMPLAINT]: 'Complaint',
  [INTENTS.PAYMENT_QUESTION]: 'Payment question',
  [INTENTS.RENEWAL_ENQUIRY]: 'Renewal enquiry',
  [INTENTS.UNKNOWN]: 'Unclear',
};

/** Short descriptions handed to the model so classification is consistent. */
export const INTENT_DESCRIPTIONS: Record<Intent, string> = {
  [INTENTS.QUOTE_REQUEST]: 'Asking for insurance or a price for the first time.',
  [INTENTS.PROVIDING_INFORMATION]: 'Supplying details such as name, address, vehicle or driver info.',
  [INTENTS.PRICE_OBJECTION]: 'Says the price is too high, expensive, or asks for something cheaper.',
  [INTENTS.REQUESTING_ALTERNATIVE_QUOTE]: 'Asks to try a different insurer or different coverage.',
  [INTENTS.WANTS_TO_PROCEED]: 'Positive intent to move forward, but not an explicit instruction to bind.',
  [INTENTS.READY_TO_BIND]: 'Explicitly agrees to buy / start the policy / make payment.',
  [INTENTS.SENDING_DOCUMENTS]: 'Sending or referring to a licence, ownership, cheque or other document.',
  [INTENTS.ASKING_QUESTION]: 'A question about coverage, process, or their file.',
  [INTENTS.REQUESTING_FOLLOW_UP]: 'Asks to be contacted later, or says they need time to think.',
  [INTENTS.NOT_INTERESTED]: 'Declines, no longer wants insurance, asks to stop contact.',
  [INTENTS.PURCHASED_ELSEWHERE]: 'Says they bought from another broker or company.',
  [INTENTS.CHANGE_INFORMATION]: 'Wants to correct or update information already given.',
  [INTENTS.NEEDS_ASSISTANCE]: 'Confused, stuck, or asking for help with something.',
  [INTENTS.GREETING]: 'Only a greeting or pleasantry with no request.',
  [INTENTS.COMPLAINT]: 'Expresses dissatisfaction with service.',
  [INTENTS.PAYMENT_QUESTION]: 'About billing, payment method, or amounts owed.',
  [INTENTS.RENEWAL_ENQUIRY]: 'About renewing an existing policy.',
  [INTENTS.UNKNOWN]: 'Cannot be determined with reasonable confidence.',
};

export function isKnownIntent(value: string): value is Intent {
  return INTENT_LIST.includes(value as Intent);
}

// ---------------------------------------------------------------------------
// Document extraction schemas
// ---------------------------------------------------------------------------

export interface ExtractorFieldSpec {
  key: string;
  label: string;
  type: 'string' | 'date' | 'number' | 'boolean';
  description: string;
  /**
   * Where this value maps in the CRM, if accepted. `null` means informational
   * only. Format: "<entity>.<field>" — resolved by src/core/documents/apply.ts.
   */
  target: string | null;
}

export interface ExtractorSpec {
  key: string;
  label: string;
  /** What the document looks like — helps the model classify it. */
  description: string;
  fields: ExtractorFieldSpec[];
}

export const EXTRACTORS: Record<string, ExtractorSpec> = {
  drivers_licence: {
    key: 'drivers_licence',
    label: "Driver's Licence",
    description: 'A provincial or state driver licence card, front or back.',
    fields: [
      { key: 'fullName', label: 'Name', type: 'string', description: 'Full name as printed', target: 'driver.fullName' },
      { key: 'address', label: 'Address', type: 'string', description: 'Street address line', target: 'client.addressLine1' },
      { key: 'city', label: 'City', type: 'string', description: 'City', target: 'client.city' },
      { key: 'province', label: 'Province', type: 'string', description: 'Province or state code', target: 'client.province' },
      { key: 'postalCode', label: 'Postal code', type: 'string', description: 'Postal or ZIP code', target: 'client.postalCode' },
      { key: 'dateOfBirth', label: 'Date of birth', type: 'date', description: 'ISO date', target: 'driver.dateOfBirth' },
      { key: 'licenceNumber', label: 'Licence number', type: 'string', description: 'Licence/DL number exactly as printed', target: 'driver.licenceNumber' },
      { key: 'licenceClass', label: 'Class', type: 'string', description: 'Licence class, e.g. G, G2, G1', target: 'driver.licenceClass' },
      { key: 'expiryDate', label: 'Expiry', type: 'date', description: 'Expiry date, ISO', target: 'driver.licenceExpiry' },
      { key: 'issueDate', label: 'Issue date', type: 'date', description: 'Issue date if printed, ISO', target: null },
    ],
  },

  vehicle_ownership: {
    key: 'vehicle_ownership',
    label: 'Vehicle Ownership',
    description: 'A vehicle registration / ownership permit showing VIN and plate.',
    fields: [
      { key: 'ownerName', label: 'Owner', type: 'string', description: 'Registered owner name', target: null },
      { key: 'vin', label: 'VIN', type: 'string', description: '17-character vehicle identification number', target: 'vehicle.vin' },
      { key: 'plate', label: 'Plate', type: 'string', description: 'Licence plate number', target: 'vehicle.plate' },
      { key: 'year', label: 'Year', type: 'number', description: 'Model year', target: 'vehicle.year' },
      { key: 'make', label: 'Make', type: 'string', description: 'Manufacturer', target: 'vehicle.make' },
      { key: 'model', label: 'Model', type: 'string', description: 'Model name', target: 'vehicle.model' },
      { key: 'address', label: 'Address', type: 'string', description: 'Registered address', target: null },
    ],
  },

  void_cheque: {
    key: 'void_cheque',
    label: 'Void Cheque / Direct Deposit',
    description: 'A cheque marked VOID or a bank direct-deposit form.',
    fields: [
      { key: 'accountHolder', label: 'Account holder', type: 'string', description: 'Name on the account', target: null },
      { key: 'institutionNumber', label: 'Institution', type: 'string', description: '3-digit institution number', target: null },
      { key: 'transitNumber', label: 'Transit', type: 'string', description: '5-digit transit/branch number', target: null },
      { key: 'accountNumber', label: 'Account', type: 'string', description: 'Account number', target: null },
      { key: 'bankName', label: 'Bank', type: 'string', description: 'Financial institution name', target: null },
    ],
  },

  driver_training: {
    key: 'driver_training',
    label: 'Driver Training Certificate',
    description: 'A ministry-approved beginner driver education certificate.',
    fields: [
      { key: 'studentName', label: 'Student', type: 'string', description: 'Name of the graduate', target: null },
      { key: 'completionDate', label: 'Completed', type: 'date', description: 'Completion date, ISO', target: 'driver.driverTrainingDate' },
      { key: 'schoolName', label: 'School', type: 'string', description: 'Driving school name', target: null },
    ],
  },

  prior_insurance: {
    key: 'prior_insurance',
    label: 'Prior Insurance Document',
    description: 'A declaration page, pink slip, or letter of experience from another insurer.',
    fields: [
      { key: 'insurerName', label: 'Insurer', type: 'string', description: 'Insurance company name', target: null },
      { key: 'policyNumber', label: 'Policy number', type: 'string', description: 'Policy number', target: null },
      { key: 'effectiveDate', label: 'Effective', type: 'date', description: 'Policy start date, ISO', target: null },
      { key: 'expiryDate', label: 'Expiry', type: 'date', description: 'Policy end date, ISO', target: null },
      { key: 'annualPremium', label: 'Premium', type: 'number', description: 'Annual premium amount', target: null },
    ],
  },

  winter_tire_photo: {
    key: 'winter_tire_photo',
    label: 'Winter Tire Photo',
    description: 'A photograph of a tire sidewall or an invoice for winter tires.',
    fields: [
      { key: 'hasSnowflakeSymbol', label: 'Snowflake symbol visible', type: 'boolean', description: 'Whether the mountain/snowflake symbol is visible', target: null },
      { key: 'tireBrand', label: 'Brand', type: 'string', description: 'Tire brand if legible', target: null },
    ],
  },

  generic: {
    key: 'generic',
    label: 'Other Document',
    description: 'Any other insurance-related document.',
    fields: [
      { key: 'documentTitle', label: 'Title', type: 'string', description: 'Heading or title of the document', target: null },
      { key: 'personName', label: 'Person', type: 'string', description: 'Primary person named', target: null },
      { key: 'documentDate', label: 'Date', type: 'date', description: 'Date on the document, ISO', target: null },
      { key: 'summary', label: 'Summary', type: 'string', description: 'One-sentence description of what this is', target: null },
    ],
  },
};

export const EXTRACTOR_KEYS = Object.keys(EXTRACTORS);
