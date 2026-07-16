# AKS Desktop telemetry dashboard queries

These panels use aggregate dimensions from the reviewed telemetry contract. Do not add raw event
exports, customer-identifying filters, drilldowns, links, or tooltips.

## Architecture

```kusto
customEvents
| where timestamp > ago(30d)
| where name == "headlamp.session-start"
| extend Architecture=tostring(customDimensions.arch)
| summarize Installs=dcount(user_Id), Sessions=count() by Architecture
| order by Installs desc
```

## Version adoption

```kusto
customEvents
| where timestamp > ago(30d)
| where name == "headlamp.session-start"
| extend AppVersion=tostring(customDimensions.appVersion),
         HeadlampVersion=tostring(customDimensions.headlampVersion)
| summarize Installs=dcount(user_Id), Sessions=count() by AppVersion, HeadlampVersion
| order by Sessions desc
```

## Error counts

```kusto
customEvents
| where timestamp > ago(30d)
| where name == "headlamp.exception"
| extend Area=tostring(customDimensions.area),
         ErrorClass=tostring(customDimensions.errorClass),
         Phase=tostring(customDimensions.phase)
| summarize Errors=count() by Area, ErrorClass, Phase
| order by Errors desc
```

## Error rate by version

```kusto
let Sessions = customEvents
| where timestamp > ago(30d)
| where name == "headlamp.session-start"
| extend AppVersion=tostring(customDimensions.appVersion)
| summarize Sessions=count() by AppVersion;
let Errors = customEvents
| where timestamp > ago(30d)
| where name == "headlamp.exception"
| extend AppVersion=tostring(customDimensions.appVersion)
| summarize Errors=count() by AppVersion;
Sessions
| join kind=fullouter Errors on AppVersion
| extend Sessions=coalesce(Sessions, 0), Errors=coalesce(Errors, 0)
| extend ErrorsPer100Sessions=iff(Sessions == 0, 0.0, 100.0 * todouble(Errors) / Sessions)
| order by ErrorsPer100Sessions desc
```

Do not define an alert threshold until production volume establishes a stable baseline. Any future
scheduled-query alert should use only the categorical `area`, `errorClass`, version, and aggregate
rate fields shown here.
