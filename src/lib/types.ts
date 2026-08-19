/**
 * Re-exports every database-derived type and enum from one place.
 *
 * Application code imports from `@/lib/types`, never from the generated
 * directory. If the ORM, the generator output path, or the generated naming
 * convention ever changes, this is the only file that has to be updated.
 *
 * Prisma 7 names row types `<Model>Model`; the aliases below restore the plain
 * domain names (`Client`, `Quote`, ...) that the rest of the codebase uses.
 */

// Enum values (usable at runtime) and their matching types.
export * from '@/generated/prisma/enums';

// The Prisma namespace: input types, payload helpers, `Prisma.Decimal`, etc.
export { Prisma } from '@/generated/prisma/client';
export type { PrismaClient } from '@/generated/prisma/client';

// Model row types.
export type {
  ActivityEventModel as ActivityEvent,
  AgeGroupModel as AgeGroup,
  AiSuggestionModel as AiSuggestion,
  AuditLogModel as AuditLog,
  ClientModel as Client,
  ClientStageHistoryModel as ClientStageHistory,
  ConversationModel as Conversation,
  CustomFieldDefinitionModel as CustomFieldDefinition,
  DocumentModel as Document,
  DocumentChecklistItemModel as DocumentChecklistItem,
  DocumentExtractionModel as DocumentExtraction,
  DocumentRequirementModel as DocumentRequirement,
  DocumentTypeModel as DocumentType,
  DriverModel as Driver,
  DriverClaimModel as DriverClaim,
  DriverConvictionModel as DriverConviction,
  FieldProvenanceModel as FieldProvenance,
  FollowUpModel as FollowUp,
  InsuranceCompanyModel as InsuranceCompany,
  JobModel as Job,
  LeadSourceModel as LeadSource,
  LostReasonModel as LostReason,
  MessageModel as Message,
  MessageAnalysisModel as MessageAnalysis,
  MessageAttachmentModel as MessageAttachment,
  NoteModel as Note,
  NotificationModel as Notification,
  PipelineStageModel as PipelineStage,
  PolicyModel as Policy,
  QuoteModel as Quote,
  QuoteStatusModel as QuoteStatus,
  SettingModel as Setting,
  TaskModel as Task,
  TaskTypeModel as TaskType,
  UserModel as User,
  VehicleModel as Vehicle,
  WebhookEventModel as WebhookEvent,
} from '@/generated/prisma/models';
