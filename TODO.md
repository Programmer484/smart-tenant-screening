# RentScreen — TODO

## Guards to add when AI gets variable/field deletion

When the AI proposal system is extended to support deleting variables or fields directly (beyond just questions), apply the same reference checks already in place for manual deletion:
- Variable deletion: check `{{key}}` in all question texts (see `getAllQuestionTexts` in property page, and `VariablesSection` deletion guard)
- Field deletion: check usage in rules and question `fieldIds` before removing
