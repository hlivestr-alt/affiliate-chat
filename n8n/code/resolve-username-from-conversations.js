function text(value) {
  return value == null ? "" : String(value);
}

const source = $("Collect Recent Replies").first().json;
const response = $json || {};
const conversations = Array.isArray(response.data && response.data.conversations)
  ? response.data.conversations
  : [];
const conversationId = text(source.conversation_id);
const senderId = text(source.affiliate_id);
const match =
  conversations.find((conversation) => text(conversation.id || conversation.conversation_id) === conversationId) ||
  conversations.find((conversation) => text(conversation.creator_im_id) === senderId) ||
  null;
const resolvedUsername = (text(source.username) || text(match && match.username))
  .normalize("NFKC")
  .trim()
  .replace(/^@+/, "");
const resolvedAffiliateId = text(source.affiliate_id) || text(match && match.creator_im_id);
const resolvedAffiliateName = text(source.affiliate_name) || resolvedUsername;

return [{
  json: {
    ...source,
    affiliate_id: resolvedAffiliateId,
    affiliate_name: resolvedAffiliateName,
    username: resolvedUsername,
    creator_im_id: text(match && match.creator_im_id),
    conversation_lookup_code: response.code,
    conversation_lookup_message: text(response.message),
    conversation_lookup_matched: Boolean(match)
  }
}];
