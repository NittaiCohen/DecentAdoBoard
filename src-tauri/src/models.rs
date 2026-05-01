use serde::{Deserialize, Serialize};

// --- ADO API response types ---

#[derive(Debug, Deserialize)]
pub struct WiqlResponse {
    #[serde(rename = "workItems")]
    pub work_items: Vec<WiqlWorkItemRef>,
}

#[derive(Debug, Deserialize)]
pub struct WiqlWorkItemRef {
    pub id: i64,
}

#[derive(Debug, Deserialize)]
pub struct WorkItemsResponse {
    pub value: Vec<AdoWorkItem>,
}

#[derive(Debug, Deserialize)]
pub struct AdoWorkItem {
    pub id: i64,
    pub fields: AdoWorkItemFields,
    pub relations: Option<Vec<AdoRelation>>,
}

#[derive(Debug, Deserialize)]
pub struct AdoWorkItemFields {
    #[serde(rename = "System.Title")]
    pub title: String,
    #[serde(rename = "System.State")]
    pub state: String,
    #[serde(rename = "System.WorkItemType")]
    pub work_item_type: String,
    #[serde(rename = "System.AssignedTo")]
    pub assigned_to: Option<AdoIdentityRef>,
    #[serde(rename = "System.IterationPath")]
    pub iteration_path: String,
    #[serde(rename = "System.AreaPath")]
    pub area_path: String,
}

#[derive(Debug, Deserialize)]
pub struct AdoIdentityRef {
    #[serde(rename = "displayName")]
    pub display_name: String,
}

#[derive(Debug, Deserialize)]
pub struct AdoRelation {
    pub rel: String,
    pub url: String,
}

#[derive(Debug, Deserialize)]
pub struct IterationsResponse {
    pub value: Vec<AdoIteration>,
}

#[derive(Debug, Deserialize)]
pub struct AdoIteration {
    pub id: String,
    pub name: String,
    pub path: String,
    pub attributes: Option<AdoIterationAttributes>,
}

#[derive(Debug, Deserialize)]
pub struct AdoIterationAttributes {
    #[serde(rename = "startDate")]
    pub start_date: Option<String>,
    #[serde(rename = "finishDate")]
    pub finish_date: Option<String>,
}

// --- PAT generation API types ---

#[derive(Debug, Deserialize)]
pub struct AzAccessTokenOutput {
    #[serde(rename = "accessToken")]
    pub access_token: String,
}

#[derive(Debug, Serialize)]
pub struct PatCreateRequest {
    #[serde(rename = "displayName")]
    pub display_name: String,
    pub scope: String,
    #[serde(rename = "validTo")]
    pub valid_to: String,
    #[serde(rename = "allOrgs")]
    pub all_orgs: bool,
}

#[derive(Debug, Deserialize)]
pub struct PatCreateResponse {
    #[serde(rename = "patTokenError")]
    pub pat_token_error: Option<String>,
    #[serde(rename = "patToken")]
    pub pat_token: Option<PatTokenInfo>,
}

#[derive(Debug, Deserialize)]
pub struct PatTokenInfo {
    pub token: Option<String>,
    #[serde(rename = "displayName")]
    pub display_name: Option<String>,
    #[serde(rename = "validTo")]
    pub valid_to: Option<String>,
    pub scope: Option<String>,
}

// --- Org/Project/Team/Area listing types ---

#[derive(Debug, Deserialize)]
pub struct ProfileResponse {
    pub id: String,
}

#[derive(Debug, Deserialize)]
pub struct AccountsResponse {
    pub value: Option<Vec<AccountInfo>>,
    // Some API versions return a flat array
    #[serde(default)]
    pub count: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccountInfo {
    #[serde(rename = "accountName")]
    pub account_name: String,
    #[serde(rename = "accountId")]
    pub account_id: String,
}

#[derive(Debug, Deserialize)]
pub struct ProjectsResponse {
    pub value: Vec<ProjectInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectInfo {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Deserialize)]
pub struct TeamsResponse {
    pub value: Vec<TeamInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TeamInfo {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Deserialize)]
pub struct ClassificationNodeResponse {
    pub name: String,
    pub path: Option<String>,
    pub children: Option<Vec<ClassificationNodeResponse>>,
}

// --- Frontend-facing types ---

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkItem {
    pub id: i64,
    pub title: String,
    pub state: String,
    pub work_item_type: String,
    pub assigned_to: Option<String>,
    pub iteration_path: String,
    pub area_path: String,
    pub predecessors: Vec<i64>,
    pub successors: Vec<i64>,
    pub parent_id: Option<i64>,
    pub children: Vec<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Iteration {
    pub id: String,
    pub name: String,
    pub path: String,
    pub start_date: Option<String>,
    pub finish_date: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdoConfig {
    pub organization: String,
    pub project: String,
    pub area_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BoardData {
    pub work_items: Vec<WorkItem>,
    pub iterations: Vec<Iteration>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PatGenerationResult {
    pub pat: String,
    pub organization: String,
    pub display_name: String,
    pub valid_to: String,
}
