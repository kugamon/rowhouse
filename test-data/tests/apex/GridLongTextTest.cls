/**
 * DEVELOPMENT ONLY. Never packaged.
 * A long text the grid shows shortened (TC-055: its first 1,000 characters and
 * "…") is never written back as if it were the whole text: not by a save
 * (a shortened cell pasted elsewhere), not by an import
 * (an exported file imported again). Consignment_Charges (test-data/config) has
 * Delivery_Notes__c as an editable column and allows import.
 */
@IsTest
private class GridLongTextTest {
    private static final Integer PREVIEW = GridController.LONG_TEXT_PREVIEW;

    private static String longText(String seed) {
        return (seed + ' ').repeat(400).trim(); // Salesforce drops a trailing space when it stores a text
    }

    /** What the grid shows of a long text. */
    private static String shortened(String whole) {
        return whole.left(PREVIEW) + '…';
    }

    private static Consignment__c record(String name, String text) {
        // Consignee__c too: Consignment_Charges has no Name column, and search reads its columns.
        Consignment__c r = new Consignment__c(Name = name, Consignee__c = name, Delivery_Notes__c = text);
        insert r;
        return r;
    }

    private static String storedText(Id recordId) {
        return [SELECT Delivery_Notes__c FROM Consignment__c WHERE Id = :recordId].Delivery_Notes__c;
    }

    @IsTest
    static void aSaveNeverWritesTheShortenedCopy() {
        System.runAs(GridTestUsers.fullUser()) {
            String whole = longText('Leave pallets by door 4 of the rear dock.');
            Consignment__c unchanged = record('Kennebec Lumber, Augusta', whole);
            Consignment__c changed = record('Penobscot Paper, Bangor', whole);
            String shortText = 'Call ahead.';
            Consignment__c ownValue = record('Casco Bay Marine, Portland', shortText);
            // the shortened form, typed over a short text
            String ownForm = 'Hold for a dock appointment. '.repeat(PREVIEW).left(PREVIEW) + '…';

            Test.startTest();
            GridSaveResult ticket = GridSaveService.save(
                'Consignment_Charges',
                new List<Map<String, Object>>{
                    new Map<String, Object>{
                        'Id' => unchanged.Id,
                        'Delivery_Notes__c' => shortened(whole),
                        'Consignee__c' => 'Kennebec Lumber, Bath'
                    },
                    new Map<String, Object>{
                        'Id' => changed.Id,
                        'Delivery_Notes__c' => 'Stack ' + shortened(whole).substring(6)
                    },
                    new Map<String, Object>{ 'Id' => ownValue.Id, 'Delivery_Notes__c' => ownForm }
                }
            );
            Test.stopTest();

            System.assertEquals(1, ticket.errors.size(), String.valueOf(ticket.errors));
            System.assertEquals(changed.Id, ticket.errors[0].recordId);
            System.assertEquals('Delivery_Notes__c', ticket.errors[0].fieldName);
            System.assertEquals(GridSaveService.SHORTENED_MESSAGE, ticket.errors[0].message);

            System.assertEquals(
                whole,
                storedText(unchanged.Id),
                'The unchanged shortened copy is left out of the write.'
            );
            System.assertEquals(
                'Kennebec Lumber, Bath',
                [SELECT Consignee__c FROM Consignment__c WHERE Id = :unchanged.Id].Consignee__c,
                'The rest of the row is saved.'
            );
            System.assertEquals(whole, storedText(changed.Id), 'A changed shortened copy is refused, not saved.');
            System.assertEquals(
                ownForm,
                storedText(ownValue.Id),
                'Over a text that is not longer, the value is the user\'s own.'
            );
        }
    }

    @IsTest
    static void anImportNeverWritesTheShortenedCopy() {
        System.runAs(GridTestUsers.fullUser()) {
            String whole = longText('Unload pallets at bay 2 by forklift.');
            Consignment__c unchanged = record('Wachusett Paper, Worcester', whole);
            Consignment__c changed = record('Quabbin Supply, Nashua', whole);

            Test.startTest();
            GridImportService.Result result = GridImportService.importRows(
                'Consignment_Charges',
                new List<Map<String, Object>>{
                    new Map<String, Object>{
                        'Id' => unchanged.Id,
                        'Delivery_Notes__c' => shortened(whole),
                        'Consignee__c' => 'Wachusett Paper, Springfield'
                    },
                    new Map<String, Object>{
                        'Id' => changed.Id,
                        'Delivery_Notes__c' => 'Secure ' + shortened(whole).substring(7)
                    },
                    new Map<String, Object>{
                        'Consignee__c' => 'Berkshire Mills, New Haven',
                        'Delivery_Notes__c' => shortened(whole)
                    }
                }
            );
            Test.stopTest();

            System.assert(result.rows[0].success, String.valueOf(result.rows[0]));
            System.assertEquals(whole, storedText(unchanged.Id), 'Exported and imported again, the whole text stays.');
            System.assertEquals(
                'Wachusett Paper, Springfield',
                [SELECT Consignee__c FROM Consignment__c WHERE Id = :unchanged.Id].Consignee__c
            );

            System.assert(!result.rows[1].success, 'A changed shortened copy fails its row.');
            System.assertEquals('Delivery_Notes__c', result.rows[1].fieldName);
            System.assert(result.rows[1].message.contains(GridSaveService.SHORTENED_MESSAGE), result.rows[1].message);
            System.assertEquals(whole, storedText(changed.Id));

            System.assert(
                result.rows[2].success && result.rows[2].created,
                'A new record has no whole text to keep: ' + String.valueOf(result.rows[2])
            );
        }
    }

    @IsTest
    static void aTextOfExactlyOneMoreCharacterIsMarkedShortened() {
        System.runAs(GridTestUsers.fullUser()) {
            // Shortened, it is as long as before: 1,000 characters and "…".
            String text = 'Inside delivery; ring at the side door. '.repeat(PREVIEW).left(PREVIEW + 1);
            record('Monadnock Granite, Concord', text);
            Map<String, Object> result = GridController.fetchRows(
                'Consignment_Charges',
                'Monadnock Granite, Concord',
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null
            );
            List<Map<String, Object>> rows = (List<Map<String, Object>>) result.get('rows');
            System.assertEquals(1, rows.size());
            System.assertEquals(shortened(text), rows[0].get('Delivery_Notes__c'));
            System.assertEquals(
                new List<String>{ 'Delivery_Notes__c' },
                rows[0].get('_cut'),
                'Its editor reads the whole text first.'
            );
        }
    }
}
