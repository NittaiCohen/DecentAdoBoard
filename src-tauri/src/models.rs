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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn work_item_serializes_to_expected_json_shape() {
        let original = WorkItem {
            id: 42,
            title: "Implement tests".to_string(),
            state: "Active".to_string(),
            work_item_type: "Task".to_string(),
            assigned_to: Some("Nittai Cohen".to_string()),
            iteration_path: "Project\\Sprint 1".to_string(),
            area_path: "Project\\Area".to_string(),
            predecessors: vec![1, 2],
            successors: vec![100],
            parent_id: Some(7),
            children: vec![8, 9],
        };

        let serialized = serde_json::to_value(&original).unwrap();

        // Verify the JSON contract matches what the frontend expects
        assert_eq!(serialized["id"], 42);
        assert_eq!(serialized["title"], "Implement tests");
        assert_eq!(serialized["state"], "Active");
        assert_eq!(serialized["work_item_type"], "Task");
        assert_eq!(serialized["assigned_to"], "Nittai Cohen");
        assert_eq!(serialized["iteration_path"], "Project\\Sprint 1");
        assert_eq!(serialized["area_path"], "Project\\Area");
        assert_eq!(serialized["predecessors"], json!([1, 2]));
        assert_eq!(serialized["successors"], json!([100]));
        assert_eq!(serialized["parent_id"], 7);
        assert_eq!(serialized["children"], json!([8, 9]));

        // Round-trip still works
        let deserialized: WorkItem =
            serde_json::from_value(serialized).unwrap();
        assert_eq!(deserialized, original);
    }

    #[test]
    fn ado_work_item_from_json() {
        let payload = json!({
            "id": 123,
            "fields": {
                "System.Title": "Fix login",
                "System.State": "Active",
                "System.WorkItemType": "Bug",
                "System.AssignedTo": {
                    "displayName": "Ada Lovelace"
                },
                "System.IterationPath": "Project\\Sprint 1",
                "System.AreaPath": "Project\\Area"
            },
            "relations": [
                {
                    "rel": "System.LinkTypes.Dependency-Forward",
                    "url": "https://dev.azure.com/org/project/_apis/wit/workItems/456"
                }
            ]
        });

        let item: AdoWorkItem = serde_json::from_value(payload).unwrap();

        assert_eq!(item.id, 123);
        assert_eq!(item.fields.title, "Fix login");
        assert_eq!(item.fields.state, "Active");
        assert_eq!(item.fields.work_item_type, "Bug");
        assert_eq!(item.fields.assigned_to.unwrap().display_name, "Ada Lovelace");
        assert_eq!(item.fields.iteration_path, "Project\\Sprint 1");
        assert_eq!(item.fields.area_path, "Project\\Area");
        assert_eq!(item.relations.unwrap()[0].rel, "System.LinkTypes.Dependency-Forward");
    }

    #[test]
    fn wiql_response_deserializes() {
        let response: WiqlResponse = serde_json::from_value(json!({
            "workItems": [{ "id": 1 }, { "id": 2 }]
        }))
        .unwrap();

        assert_eq!(response.work_items.len(), 2);
        assert_eq!(response.work_items[0].id, 1);
        assert_eq!(response.work_items[1].id, 2);
    }

    #[test]
    fn ado_work_item_fields_missing_assigned_to_is_none() {
        let fields: AdoWorkItemFields = serde_json::from_value(json!({
            "System.Title": "Fix login",
            "System.State": "Active",
            "System.WorkItemType": "Bug",
            "System.IterationPath": "Project\\Sprint 1",
            "System.AreaPath": "Project\\Area"
        }))
        .unwrap();

        assert!(fields.assigned_to.is_none());
    }

    #[test]
    fn ado_relation_parsing() {
        let relation: AdoRelation = serde_json::from_value(json!({
            "rel": "System.LinkTypes.Hierarchy-Reverse",
            "url": "https://dev.azure.com/org/project/_apis/wit/workItems/77"
        }))
        .unwrap();

        assert_eq!(relation.rel, "System.LinkTypes.Hierarchy-Reverse");
        assert_eq!(relation.url, "https://dev.azure.com/org/project/_apis/wit/workItems/77");
    }

    #[test]
    fn iteration_with_and_without_attributes_deserializes() {
        let with_attributes: AdoIteration = serde_json::from_value(json!({
            "id": "iteration-1",
            "name": "Sprint 1",
            "path": "Project\\Sprint 1",
            "attributes": {
                "startDate": "2025-01-06T00:00:00Z",
                "finishDate": "2025-01-19T00:00:00Z"
            }
        }))
        .unwrap();
        let without_attributes: AdoIteration = serde_json::from_value(json!({
            "id": "iteration-2",
            "name": "Backlog",
            "path": "Project\\Backlog"
        }))
        .unwrap();

        assert_eq!(with_attributes.id, "iteration-1");
        assert_eq!(with_attributes.attributes.unwrap().start_date.as_deref(), Some("2025-01-06T00:00:00Z"));
        assert!(without_attributes.attributes.is_none());
    }

    #[test]
    fn account_project_and_team_info_deserialize() {
        let account: AccountInfo = serde_json::from_value(json!({
            "accountName": "org-name",
            "accountId": "account-123"
        }))
        .unwrap();
        let project: ProjectInfo = serde_json::from_value(json!({
            "id": "project-123",
            "name": "DecentAdoBoard"
        }))
        .unwrap();
        let team: TeamInfo = serde_json::from_value(json!({
            "id": "team-123",
            "name": "Platform"
        }))
        .unwrap();

        assert_eq!(account.account_name, "org-name");
        assert_eq!(account.account_id, "account-123");
        assert_eq!(project.id, "project-123");
        assert_eq!(project.name, "DecentAdoBoard");
        assert_eq!(team.id, "team-123");
        assert_eq!(team.name, "Platform");
    }

    #[test]
    fn pat_create_response_with_error() {
        let response: PatCreateResponse = serde_json::from_value(json!({
            "patTokenError": "token creation failed",
            "patToken": null
        }))
        .unwrap();

        assert_eq!(response.pat_token_error.as_deref(), Some("token creation failed"));
        assert!(response.pat_token.is_none());
    }

    #[test]
    fn pat_create_response_with_token() {
        let response: PatCreateResponse = serde_json::from_value(json!({
            "patTokenError": null,
            "patToken": {
                "token": "secret-token",
                "displayName": "DecentAdoBoard PAT",
                "validTo": "2025-12-31T00:00:00Z",
                "scope": "vso.work"
            }
        }))
        .unwrap();

        let token = response.pat_token.unwrap();
        assert!(response.pat_token_error.is_none());
        assert_eq!(token.token.as_deref(), Some("secret-token"));
        assert_eq!(token.display_name.as_deref(), Some("DecentAdoBoard PAT"));
        assert_eq!(token.valid_to.as_deref(), Some("2025-12-31T00:00:00Z"));
        assert_eq!(token.scope.as_deref(), Some("vso.work"));
    }
}
