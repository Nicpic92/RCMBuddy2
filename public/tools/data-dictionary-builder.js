// public/tools/data-dictionary-builder.js

// --- Global Variables ---
let currentHeaders = []; // Stores the headers of the currently processed file/dictionary (for active sheet)
let currentDictionaryId = null; // Stores the ID of the dictionary currently being edited (null for new ones)
let uploadedOriginalFileName = null; // Stores the name of the file uploaded to extract headers for a NEW dictionary
let isEditingExistingDictionary = false; // Flag to differentiate between creating new and editing existing
let allExistingRulesMap = new Map(); // Stores all rules from all existing dictionaries for pre-population by column name

let currentWorkbook = null; // Stores the parsed Excel workbook object for multi-sheet validation
let currentSheetName = null; // Stores the name of the currently active sheet for rule definition

let sheetHeadersMap = new Map(); // NEW: Stores headers for each sheet: Map<sheetName, Array<headerStrings>>
let sheetRulesMap = new Map(); // NEW: Stores rules for each sheet that the user has defined/loaded: Map<sheetName, Array<ruleObjects>>


// --- Helper Functions (reused and adapted) ---

/**
 * Displays the loading spinner and disables relevant buttons/sections.
 * @param {string} targetLoaderId - The ID of the loader element to show.
 */
function showLoader(targetLoaderId = 'initialLoader') {
    document.getElementById(targetLoaderId).style.display = 'block';
    // Disable primary action buttons while loading
    document.getElementById('loadExistingDictionaryBtn').disabled = true;
    document.getElementById('createNewDictionaryBtn').disabled = true;
    document.getElementById('saveDictionaryBtn').disabled = true;
    document.getElementById('printDictionaryBtn').disabled = true; // Disable print button
}

/**
 * Hides the loading spinner and enables relevant buttons/sections.
 * @param {string} targetLoaderId - The ID of the loader element to hide.
 */
function hideLoader(targetLoaderId = 'initialLoader') {
    document.getElementById(targetLoaderId).style.display = 'none';
    // Re-enable primary action buttons, save/print will be managed by table content
    document.getElementById('loadExistingDictionaryBtn').disabled = false;
    document.getElementById('createNewDictionaryBtn').disabled = false;
    // Save/print buttons re-enabled based on whether headers are loaded or existing dict is loaded
    // Managed by renderHeadersTable and loadDictionaryForEditing
}

/**
 * Displays a message on the UI.
 * @param {string} elementId - The ID of the HTML element to display the message in.
 * @param {string} message - The message text.
 * @param {'info' | 'success' | 'error'} type - The type of message (influences styling via classes).
 */
function displayMessage(elementId, message, type = 'info') {
    const element = document.getElementById(elementId);
    if (element) {
        element.textContent = message;
        // Remove existing color classes to prevent conflicts
        element.classList.remove('text-red-600', 'text-green-600', 'text-gray-600');
        // Add new color class based on message type
        if (type === 'error') {
            element.classList.add('text-red-600');
        } else if (type === 'success') {
            element.classList.add('text-green-600');
        } else {
            element.classList.add('text-gray-600'); // Default for info
        }
        element.style.display = 'block'; // Ensure message is visible
    }
}

// --- Authentication and Navigation (reused) ---

/**
 * Verifies the JWT token stored in localStorage with the backend.
 * Redirects to login if token is missing or invalid.
 * @returns {Promise<object | null>} User data if token is valid, otherwise null.
 */
async function verifyToken() {
    const token = localStorage.getItem('jwtToken');
    if (!token) {
        window.location.href = '/'; // Redirect to login if no token
        return null;
    }

    try {
        const response = await fetch('/api/protected', {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!response.ok) {
            console.error('Token verification failed:', response.statusText);
            localStorage.removeItem('jwtToken');
            window.location.href = '/';
            return null;
        }

        const data = await response.json();
        console.log('User data:', data); // Log user data for debugging
        return data; // Contains user and company info
    } catch (error) {
        console.error('Error verifying token:', error);
        localStorage.removeItem('jwtToken');
        window.location.href = '/';
        return null;
    }
}

/**
 * Sets up navigation elements based on user data.
 * @param {object} userData - The user data obtained from token verification.
 */
function setupNavigation(userData) {
    const profileLink = document.getElementById('profileLink');
    if (profileLink && userData && userData.user) {
        profileLink.textContent = `Hello, ${userData.user.username}`;
        profileLink.href = '#'; // Placeholder, replace with actual profile page link if exists
    }

    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', (e) => {
            e.preventDefault();
            localStorage.removeItem('jwtToken');
            window.location.href = '/'; // Redirect to login page
        });
    }
}

// --- Initial Setup: Populate Existing Dictionaries Dropdown & Load Existing Rules ---

/**
 * Fetches the list of uploaded data dictionaries from the backend and populates the select dropdown.
 * Also populates allExistingRulesMap for pre-population feature.
 */
async function populateExistingDictionariesDropdown() {
    console.log("populateExistingDictionariesDropdown: Starting fetch."); // DEBUG
    const token = localStorage.getItem('jwtToken');
    if (!token) {
        console.warn('populateExistingDictionariesDropdown: No token found. Cannot fetch dictionaries.');
        return;
    }

    displayMessage('existingDictStatus', 'Loading existing dictionaries...', 'info');
    const dropdown = document.getElementById('existingDictionarySelect');
    dropdown.innerHTML = '<option value="">-- Loading --</option>'; // Temporary loading message

    allExistingRulesMap = new Map(); // Clear previous map content

    try {
        const response = await fetch('/api/list-data-dictionaries', {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ message: response.statusText }));
            console.error('populateExistingDictionariesDropdown: Failed to fetch dictionaries:', response.status, errorData.message);
            displayMessage('existingDictStatus', `Failed to load dictionaries: ${errorData.message || 'Server error.'}`, 'error');
            dropdown.innerHTML = '<option value="">-- Error Loading --</option>';
            dropdown.disabled = true;
            document.getElementById('loadExistingDictionaryBtn').disabled = true;
            return;
        }

        const result = await response.json();
        const dataDictionaries = result.dictionaries || [];
        console.log("populateExistingDictionariesDropdown: Fetched dataDictionaries:", dataDictionaries); // DEBUG

        dropdown.innerHTML = '<option value="">-- Select an Existing Dictionary --</option>';

        let hasDataDictionaries = false;
        if (dataDictionaries.length > 0) {
            dataDictionaries.forEach(dict => {
                const option = document.createElement('option');
                option.value = dict.id;
                option.textContent = dict.name;
                dropdown.appendChild(option);

                // Populate allExistingRulesMap for pre-population
                if (dict.rules_json && Array.isArray(dict.rules_json)) {
                    dict.rules_json.forEach(rule => {
                        const colName = String(rule['Column Name'] || rule.column_name || '').trim(); // Adapt to potential old/new naming
                        if (colName && !allExistingRulesMap.has(colName)) {
                            allExistingRulesMap.set(colName, rule);
                        }
                    });
                }
            });
            hasDataDictionaries = true;
            displayMessage('existingDictStatus', `${dataDictionaries.length} dictionaries loaded.`, 'success');
        } else {
            displayMessage('existingDictStatus', 'No data dictionaries found for your company.', 'info');
            dropdown.innerHTML = '<option value="">No data dictionaries available.</option>';
        }

        dropdown.disabled = !hasDataDictionaries;
        document.getElementById('loadExistingDictionaryBtn').disabled = !hasDataDictionaries;

        console.log("populateExistingDictionariesDropdown: allExistingRulesMap populated with (size):", allExistingRulesMap.size); // DEBUG
        console.log("populateExistingDictionariesDropdown: allExistingRulesMap contents (first 5):", Array.from(allExistingRulesMap.entries()).slice(0, 5)); // DEBUG

    } catch (error) {
        console.error('populateExistingDictionariesDropdown: Network or parsing error:', error);
        displayMessage('existingDictStatus', `An unexpected error occurred: ${error.message}`, 'error');
        dropdown.innerHTML = '<option value="">-- Error --</option>';
        dropdown.disabled = true;
        document.getElementById('loadExistingDictionaryBtn').disabled = true;
    }
}

/**
 * Loads the selected data dictionary's rules from the backend for editing.
 */
async function loadDictionaryForEditing() {
    console.log("loadDictionaryForEditing: Starting."); // DEBUG
    const selectedDictId = document.getElementById('existingDictionarySelect').value;
    if (!selectedDictId) {
        displayMessage('existingDictStatus', 'Please select a dictionary from the list to load for editing.', 'error');
        return;
    }

    showLoader('initialLoader');
    displayMessage('existingDictStatus', 'Loading dictionary for editing...', 'info');

    const token = localStorage.getItem('jwtToken');
    try {
        const response = await fetch(`/api/get-data-dictionary?id=${selectedDictId}`, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!response.ok) {
            throw new Error(`Failed to load dictionary: ${response.statusText || 'Server error'}`);
        }
        const dictionary = await response.json();

        console.log("loadDictionaryForEditing: Received dictionary data:", dictionary); // DEBUG

        currentDictionaryId = dictionary.id;
        document.getElementById('dictionaryName').value = dictionary.name;
        isEditingExistingDictionary = true;

        const loadedRules = dictionary.rules_json || [];
        const loadedSourceHeaders = dictionary.source_headers_json || [];

        // Determine currentSheetName based on dictionary name format
        const nameParts = dictionary.name.split(' - ');
        currentSheetName = (nameParts.length > 1) ? nameParts[nameParts.length - 1] : 'Sheet1'; // Assumes last part is sheet name
        uploadedOriginalFileName = dictionary.name.replace(` - ${currentSheetName}`, ''); // Infer original file name

        // Reset and populate sheet maps
        sheetHeadersMap.clear();
        sheetRulesMap.clear();

        // If a dictionary is loaded, its rules and headers correspond to ONE sheet
        sheetHeadersMap.set(currentSheetName, loadedSourceHeaders);
        sheetRulesMap.set(currentSheetName, loadedRules);

        // Simulate a workbook with just this sheet for validation purposes
        // *** FIX for Printing issue with loaded dictionaries: ensure currentWorkbook is reset ***
        currentWorkbook = null; // Clear any previous workbook state
        currentWorkbook = { SheetNames: [currentSheetName], Sheets: {} };
        currentWorkbook.Sheets[currentSheetName] = XLSX.utils.aoa_to_sheet([loadedSourceHeaders]);
        // *** END FIX ***
        
        // Populate sheet selector dropdown and select the loaded sheet
        populateSheetSelectionDropdown(currentWorkbook.SheetNames);
        document.getElementById('sheetSelector').value = currentSheetName;

        currentHeaders = loadedSourceHeaders; // Set currentHeaders for rendering
        renderHeadersTable(currentHeaders, loadedRules);

        // MODIFIED: Hide initial section and show the full-screen overlay for the builder
        document.getElementById('initialSelectionSection').classList.add('hidden');
        document.getElementById('dataDictionaryOverlay').classList.remove('hidden'); // Show the overlay
        document.getElementById('printDictionaryBtn').disabled = (currentWorkbook === null); // Enable print if a workbook (even a simulated one) is present


        displayMessage('existingDictStatus', `Dictionary "${dictionary.name}" loaded for editing.`, 'success');
        console.log("loadDictionaryForEditing: Finished. currentSheetName:", currentSheetName, "sheetRulesMap:", sheetRulesMap); // DEBUG

    } catch (error) {
        console.error('Error loading dictionary for editing:', error);
        displayMessage('existingDictStatus', `Failed to load dictionary: ${error.message}`, 'error');
        currentDictionaryId = null;
        isEditingExistingDictionary = false;
    } finally {
        hideLoader('initialLoader');
    }
}

/**
 * Handles the upload of a new Excel/CSV file to extract headers for a new dictionary.
 * Now pre-populates rules from other existing dictionaries if matching headers are found.
 */
async function startNewDictionaryFromUpload() {
    console.log("startNewDictionaryFromUpload: Starting."); // DEBUG
    const excelFile = document.getElementById('excelFile').files[0];
    if (!excelFile) {
        displayMessage('newDictStatus', 'Please select an Excel or CSV file to extract headers.', 'error');
        return;
    }

    showLoader('initialLoader');
    displayMessage('newDictStatus', `Extracting headers from ${excelFile.name}...`, 'info');

    currentDictionaryId = null;
    uploadedOriginalFileName = excelFile.name;
    isEditingExistingDictionary = false;

    currentWorkbook = null; // Clear previous workbook on new upload
    sheetHeadersMap.clear(); // Clear previous sheet headers
    sheetRulesMap.clear(); // Clear previous sheet rules
    currentSheetName = null; // Clear current sheet name

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            currentWorkbook = workbook; // Store the workbook globally
            console.log("startNewDictionaryFromUpload: Workbook loaded:", currentWorkbook); // DEBUG

            if (workbook.SheetNames.length === 0) {
                throw new Error('No sheets found in the uploaded file.');
            }

            // Populate sheet selection dropdown
            populateSheetSelectionDropdown(workbook.SheetNames);

            // Extract headers for all sheets and store them
            workbook.SheetNames.forEach(sheetName => {
                const worksheet = workbook.Sheets[sheetName];
                const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: null });
                
                let headers = [];
                if (jsonData.length > 0) {
                    for(let i = 0; i < jsonData.length; i++) {
                        const row = jsonData[i];
                        // Find the first non-empty row to consider as headers
                        if (row && row.some(cell => cell !== null && String(cell).trim() !== '')) {
                            headers = row.map(h => h === null || h === undefined ? '' : String(h).trim()).filter(h => h !== '');
                            break;
                        }
                    }
                }
                sheetHeadersMap.set(sheetName, headers);
                // Initialize rules for this sheet (pre-fill from allExistingRulesMap if match)
                const initialRulesForSheet = [];
                headers.forEach(header => {
                    const cleanedHeader = String(header).trim();
                    if (allExistingRulesMap.has(cleanedHeader)) {
                        initialRulesForSheet.push(allExistingRulesMap.get(cleanedHeader));
                    } else {
                        initialRulesForSheet.push({ 'Column Name': cleanedHeader });
                    }
                });
                sheetRulesMap.set(sheetName, initialRulesForSheet); // Store for each sheet
            });
            console.log("startNewDictionaryFromUpload: sheetHeadersMap:", sheetHeadersMap); // DEBUG
            console.log("startNewDictionaryFromUpload: sheetRulesMap (initial):", sheetRulesMap); // DEBUG


            // Automatically load the first sheet's headers and rules for initial display
            currentSheetName = workbook.SheetNames[0];
            document.getElementById('sheetSelector').value = currentSheetName; // Select the first sheet in dropdown

            const firstSheetHeaders = sheetHeadersMap.get(currentSheetName) || [];
            
            if (firstSheetHeaders.length === 0) {
                console.warn(`First sheet "${currentSheetName}" has no headers. Please select another sheet if available.`);
            }

            currentHeaders = firstSheetHeaders; // Set currentHeaders for rendering
            document.getElementById('dictionaryName').value = `${uploadedOriginalFileName.replace(/\.(xlsx|xls|csv)$/i, '').trim()} - ${currentSheetName}`;

            renderHeadersTable(currentHeaders, sheetRulesMap.get(currentSheetName)); // Render table for the first sheet

            // MODIFIED: Hide initial section and show the full-screen overlay for the builder
            document.getElementById('initialSelectionSection').classList.add('hidden');
            document.getElementById('dataDictionaryOverlay').classList.remove('hidden'); // Show the overlay
            document.getElementById('printDictionaryBtn').disabled = false; // Enable print since workbook is available

            displayMessage('newDictStatus', `Headers extracted from "${excelFile.name}". Select a sheet to define rules.`, 'success');

        } catch (error) {
            console.error('Error processing uploaded file for headers:', error);
            displayMessage('newDictStatus', `Failed to extract headers: ${error.message}`, 'error');
            currentHeaders = [];
            currentWorkbook = null; // Clear workbook if processing failed
            sheetHeadersMap.clear();
            sheetRulesMap.clear();
            currentSheetName = null;
            populateSheetSelectionDropdown([]); // Clear sheet dropdown
        } finally {
            hideLoader('initialLoader');
            document.getElementById('excelFile').value = '';
        }
    };
    reader.readAsArrayBuffer(excelFile);
}

/**
 * NEW: Populates the sheet selection dropdown with sheet names.
 * @param {Array<string>} sheetNames - An array of sheet names.
 */
function populateSheetSelectionDropdown(sheetNames) {
    console.log("populateSheetSelectionDropdown: Populating with names:", sheetNames); // DEBUG
    const sheetSelector = document.getElementById('sheetSelector');
    sheetSelector.innerHTML = ''; // Clear existing options

    if (sheetNames.length === 0) {
        sheetSelector.innerHTML = '<option value="">No sheets found</option>';
        sheetSelector.disabled = true;
    } else {
        sheetNames.forEach(name => {
            const option = document.createElement('option');
            option.value = name;
            option.textContent = name;
            sheetSelector.appendChild(option);
        });
        sheetSelector.disabled = false;
    }
}

/**
 * NEW: Handles the change event for the sheet selection dropdown.
 * Loads the selected sheet's headers and rules into the UI.
 */
function handleSheetSelectionChange() {
    console.log("handleSheetSelectionChange: Event triggered."); // DEBUG
    const selectedSheet = document.getElementById('sheetSelector').value;
    if (selectedSheet && currentWorkbook && sheetHeadersMap.has(selectedSheet)) {
        // Step 1: Save rules for the *currently active* sheet (before switching)
        // Ensure that there was a previous sheet selected and it had content to collect rules from
        if (currentSheetName && sheetHeadersMap.get(currentSheetName).length > 0) {
            const currentSheetRules = collectRules(); // Collect from UI for the sheet we are leaving
            sheetRulesMap.set(currentSheetName, currentSheetRules); // Save to map
            console.log(`handleSheetSelectionChange: Saved rules for previous sheet "${currentSheetName}":`, currentSheetRules); // DEBUG
        }
        
        // Step 2: Update global sheet reference
        currentSheetName = selectedSheet;
        currentHeaders = sheetHeadersMap.get(currentSheetName);
        console.log(`handleSheetSelectionChange: Switched to sheet "${currentSheetName}". Headers:`, currentHeaders); // DEBUG

        // Step 3: Load rules for the newly selected sheet, or initialize if none exist yet
        let rulesToRender = sheetRulesMap.get(currentSheetName);
        if (!rulesToRender) {
            // This case should ideally not happen if sheetRulesMap is populated on upload
            // but as a fallback, re-initialize if somehow missing
            rulesToRender = [];
            currentHeaders.forEach(header => {
                const cleanedHeader = String(header).trim();
                if (allExistingRulesMap.has(cleanedHeader)) {
                    rulesToRender.push(allExistingRulesMap.get(cleanedHeader));
                } else {
                    rulesToRender.push({ 'Column Name': cleanedHeader });
                }
            });
            sheetRulesMap.set(currentSheetName, rulesToRender);
            console.log(`handleSheetSelectionChange: Re-initialized rules for "${currentSheetName}":`, rulesToRender); // DEBUG
        }
        console.log(`handleSheetSelectionChange: Rules to render for "${currentSheetName}":`, rulesToRender); // DEBUG


        // Step 4: Update Dictionary Name input
        document.getElementById('dictionaryName').value = `${uploadedOriginalFileName.replace(/\.(xlsx|xls|csv)$/i, '').trim()} - ${currentSheetName}`;

        // Step 5: Render table for the newly selected sheet
        renderHeadersTable(currentHeaders, rulesToRender);
        displayMessage('saveStatus', `Now defining rules for sheet: "${currentSheetName}".`, 'info');
    } else {
        console.warn("handleSheetSelectionChange: Sheet selection changed to empty or invalid sheet. Selected:", selectedSheet, "currentWorkbook:", currentWorkbook, "sheetHeadersMap.has(selectedSheet):", sheetHeadersMap.has(selectedSheet)); // DEBUG
        displayMessage('saveStatus', 'Please select a valid sheet.', 'error');
        // Do NOT call resetBuilderUI here, as it clears the whole workbook state.
        // The user might just select an invalid option momentarily.
    }
}


// --- Core Logic: Render Headers Table for Rule Definition ---

// Common dropdown options for Data Type and Security Classification
const dataTypeOptions = [
    { value: '', text: 'Select Data Type' },
    { value: 'Text/String', text: 'Text/String' },
    { value: 'Integer', text: 'Integer' },
    { value: 'Decimal', text: 'Decimal' },
    { value: 'Date', text: 'Date' },
    { value: 'Boolean', text: 'Boolean (True/False)' }
];

const nullabilityOptions = [
    { value: '', text: 'Select Nullability' },
    { value: 'Required', text: 'Required' },
    { value: 'Optional', text: 'Optional' }
];

const securityClassificationOptions = [
    { value: '', text: 'Select Classification' },
    { value: 'Public', text: 'Public' },
    { value: 'Internal', text: 'Internal' },
    { value: 'Confidential', text: 'Confidential' },
    { value: 'PII', text: 'PII (Personally Identifiable Info)' },
    { value: 'PHI', text: 'PHI (Protected Health Info)' },
    { value: 'Restricted', text: 'Restricted' }
];

/**
 * Renders a select dropdown with given options and optional pre-selected value.
 * @param {Array<object>} options - Array of {value, text} for select options.
 * @param {string} selectedValue - The value to pre-select.
 * @returns {HTMLSelectElement} The created select element.
 */
function createSelectElement(options, selectedValue = '') {
    const select = document.createElement('select');
    select.classList.add('p-2', 'border', 'border-gray-300', 'rounded-md', 'focus:ring-blue-500', 'focus:border-blue-500', 'text-gray-800', 'w-full');
    options.forEach(optionData => {
        const option = document.createElement('option');
        option.value = optionData.value;
        option.textContent = optionData.text;
        if (optionData.value === selectedValue) {
            option.selected = true;
        }
        select.appendChild(option);
    });
    return select;
}

/**
 * Renders the table of headers, pre-filling rules if `rulesToPreFill` are provided.
 * @param {Array<string>} headers - Headers to display in the table.
 * @param {Array<object>} rulesToPreFill - Existing rules to pre-fill the form (optional). This array now contains comprehensive rule objects.
 */
function renderHeadersTable(headers, rulesToPreFill = []) {
    console.log("renderHeadersTable: Function started.");
    console.log("renderHeadersTable: Headers received:", headers);
    console.log("renderHeadersTable: Rules to pre-fill received:", rulesToPreFill);

    const tbody = document.querySelector('#headersTable tbody');
    if (!tbody) {
        console.error("renderHeadersTable: tbody element not found!");
        displayMessage('saveStatus', 'Error: Table body not found in HTML. Please contact support.', 'error');
        return;
    }
    tbody.innerHTML = ''; // Clear existing rows

    // Create a map for quick lookup of comprehensive rules by column name (for pre-filling logic)
    const rulesMap = new Map();
    rulesToPreFill.forEach(rule => {
        const colName = String(rule['Column Name'] || rule.column_name || '').trim(); // Be flexible with column name key
        if (colName) {
            rulesMap.set(colName, rule);
        }
    });
    console.log("renderHeadersTable: Rules map created for current rendering:", rulesMap); // DEBUG

    const validationTypes = [
        { value: '', text: 'None' },
        { value: 'REQUIRED', text: 'Required (Not Blank)' },
        { value: 'ALLOWED_VALUES', text: 'Allowed Values (Comma-separated)' },
        { value: 'NUMERIC_RANGE', text: 'Numeric Range (e.g., 0-100)' },
        { value: 'REGEX', text: 'Regex Pattern' },
        { value: 'DATE_PAST', text: 'Date in Past' },
        { value: 'UNIQUE', text: 'Unique Value' }
    ];

    if (headers.length === 0) {
        const row = tbody.insertCell();
        const cell = row.insertCell();
        cell.colSpan = 19; // Adjusted colspan for all new columns
        cell.textContent = "No headers available to define rules. Upload a file or load a dictionary with headers.";
        cell.style.textAlign = 'center';
        cell.style.padding = '20px';
        console.warn("renderHeadersTable: No headers provided for rendering.");
        document.getElementById('saveDictionaryBtn').disabled = true;
        document.getElementById('printDictionaryBtn').disabled = true;
        return;
    } else {
        document.getElementById('saveDictionaryBtn').disabled = false;
        document.getElementById('printDictionaryBtn').disabled = false;
    }

    headers.forEach((header, index) => {
        console.log(`renderHeadersTable: Processing header: "${header}" (Index: ${index})`); // DEBUG

        const row = tbody.insertRow();
        row.insertCell().textContent = header; // Column Name (Read-only from file)

        const existingRule = rulesMap.get(String(header).trim()) || {}; // Get existing comprehensive rule or empty object

        // --- Add new comprehensive data dictionary fields ---

        // Removed: Display Name input field and its append call
        // The column for Display Name is also removed from the HTML table header

        // Definition/Description
        const descriptionTextarea = document.createElement('textarea');
        descriptionTextarea.classList.add('dd-description', 'p-2', 'border', 'border-gray-300', 'rounded-md', 'focus:ring-blue-500', 'focus:border-blue-500', 'text-gray-800', 'w-full', 'h-20'); // Added h-20 for height
        descriptionTextarea.placeholder = 'e.g., A unique identifier assigned to each patient.';
        descriptionTextarea.value = existingRule.description || ''; // Pre-fill
        row.insertCell().appendChild(descriptionTextarea);

        // Data Type
        const dataTypeSelect = createSelectElement(dataTypeOptions, existingRule.data_type); // Pre-fill
        dataTypeSelect.classList.add('dd-data-type');
        row.insertCell().appendChild(dataTypeSelect);

        // Length/Size
        const lengthInput = document.createElement('input');
        lengthInput.type = 'text'; // Can be text to allow "max 255" or numbers only
        lengthInput.classList.add('dd-length-size', 'p-2', 'border', 'border-gray-300', 'rounded-md', 'focus:ring-blue-500', 'focus:border-blue-500', 'text-gray-800', 'w-full');
        lengthInput.placeholder = 'e.g., 50 or 10,2';
        lengthInput.value = existingRule.length_size || ''; // Pre-fill
        row.insertCell().appendChild(lengthInput);

        // Format
        const formatInput = document.createElement('input');
        formatInput.type = 'text';
        formatInput.classList.add('dd-format', 'p-2', 'border', 'border-gray-300', 'rounded-md', 'focus:ring-blue-500', 'focus:border-blue-500', 'text-gray-800', 'w-full');
        formatInput.placeholder = 'e.g.,YYYY-MM-DD';
        formatInput.value = existingRule.format || ''; // Pre-fill
        row.insertCell().appendChild(formatInput);

        // Allowable Values/Domain
        const allowableValuesTextarea = document.createElement('textarea');
        allowableValuesTextarea.classList.add('dd-allowable-values', 'p-2', 'border', 'border-gray-300', 'rounded-md', 'focus:ring-blue-500', 'focus:border-blue-500', 'text-gray-800', 'w-full', 'h-20'); // Added h-20 for height
        allowableValuesTextarea.placeholder = 'e.g., Yes,No,Maybe or 1-100';
        allowableValuesTextarea.value = existingRule.allowable_values || ''; // Pre-fill
        row.insertCell().appendChild(allowableValuesTextarea);

        // Nullability
        const nullabilitySelect = createSelectElement(nullabilityOptions, existingRule.nullability); // Pre-fill
        nullabilitySelect.classList.add('dd-nullability');
        row.insertCell().appendChild(nullabilitySelect);

        // Source System(s)
        const sourceSystemInput = document.createElement('input');
        sourceSystemInput.type = 'text';
        sourceSystemInput.classList.add('dd-source-systems', 'p-2', 'border', 'border-gray-300', 'rounded-md', 'focus:ring-blue-500', 'focus:border-blue-500', 'text-gray-800', 'w-full');
        sourceSystemInput.placeholder = 'e.g., Enrollment System';
        sourceSystemInput.value = existingRule.source_systems || ''; // Pre-fill
        row.insertCell().appendChild(sourceSystemInput);

        // Target System(s)/Usage
        const targetSystemInput = document.createElement('input');
        targetSystemInput.type = 'text';
        targetSystemInput.classList.add('dd-target-systems', 'p-2', 'border', 'border-gray-300', 'rounded-md', 'focus:ring-blue-500', 'focus:border-blue-500', 'text-gray-800', 'w-full');
        targetSystemInput.placeholder = 'e.g., Reporting, Claims';
        targetSystemInput.value = existingRule.target_systems || ''; // Pre-fill
        row.insertCell().appendChild(targetSystemInput);

        // Business Rules/Constraints
        const businessRulesTextarea = document.createElement('textarea');
        businessRulesTextarea.classList.add('dd-business-rules', 'p-2', 'border', 'border-gray-300', 'rounded-md', 'focus:ring-blue-500', 'focus:border-blue-500', 'text-gray-800', 'w-full', 'h-20');
        businessRulesTextarea.placeholder = 'e.g., Must be unique per customer.';
        businessRulesTextarea.value = existingRule.business_rules || ''; // Pre-fill
        row.insertCell().appendChild(businessRulesTextarea);

        // Relationship to Other Elements/Tables
        const relationshipInput = document.createElement('input');
        relationshipInput.type = 'text';
        relationshipInput.classList.add('dd-relationship', 'p-2', 'border', 'border-gray-300', 'rounded-md', 'focus:ring-blue-500', 'focus:border-blue-500', 'text-gray-800', 'w-full');
        relationshipInput.placeholder = 'e.g., FK to Customers.CustID';
        relationshipInput.value = existingRule.relationships || ''; // Pre-fill
        row.insertCell().appendChild(relationshipInput);

        // Ownership/Stewardship
        const ownershipInput = document.createElement('input');
        ownershipInput.type = 'text';
        ownershipInput.classList.add('dd-ownership', 'p-2', 'border', 'border-gray-300', 'rounded-md', 'focus:ring-blue-500', 'focus:border-blue-500', 'text-gray-800', 'w-full');
        ownershipInput.placeholder = 'e.g., IT Data Team';
        ownershipInput.value = existingRule.ownership || ''; // Pre-fill
        row.insertCell().appendChild(ownershipInput);

        // Security Classification
        const securitySelect = createSelectElement(securityClassificationOptions, existingRule.security_classification); // Pre-fill
        securitySelect.classList.add('dd-security-classification');
        row.insertCell().appendChild(securitySelect);

        // --- Existing Validation Fields ---
        // Validation Type
        const typeCell = row.insertCell();
        const typeSelect = document.createElement('select');
        typeSelect.classList.add('validation-type-select', 'p-2', 'border', 'border-gray-300', 'rounded-md', 'focus:ring-blue-500', 'focus:border-blue-500', 'text-gray-800', 'w-full');
        typeSelect.name = `type_${index}`;
        validationTypes.forEach(type => {
            const option = document.createElement('option');
            option.value = type.value;
            option.textContent = type.text;
            typeSelect.appendChild(option);
        });
        typeCell.appendChild(typeSelect);

        // Validation Value
        const valueCell = row.insertCell();
        const valueInput = document.createElement('input');
        valueInput.type = 'text';
        valueInput.classList.add('validation-value-input', 'mt-1', 'block', 'w-full', 'p-2', 'border', 'border-gray-300', 'rounded-md', 'focus:ring-green-500', 'focus:border-green-500', 'text-gray-800');
        valueInput.name = `value_${index}`;
        valueInput.placeholder = 'e.g., Value1,Value2 or 0-100 or ^\\d{5}$';
        valueInput.style.setProperty('display', 'none', 'important'); // Hidden by default
        valueCell.appendChild(valueInput);

        const descriptionDiv = document.createElement('div');
        descriptionDiv.classList.add('rule-description', 'text-xs', 'text-gray-500', 'mt-1');
        valueCell.appendChild(descriptionDiv);

        // Failure Message
        const messageCell = row.insertCell();
        const messageInput = document.createElement('input');
        messageInput.type = 'text';
        messageInput.classList.add('failure-message-input', 'mt-1', 'block', 'w-full', 'p-2', 'border', 'border-gray-300', 'rounded-md', 'focus:ring-green-500', 'focus:border-green-500', 'text-gray-800');
        messageInput.name = `message_${index}`;
        messageInput.placeholder = 'e.g., Field cannot be blank.';
        messageCell.appendChild(messageInput);

        // --- Read-only Metadata Fields ---
        // These are typically managed by the backend on save/load, not directly editable by user here.
        // They will be populated when loading an existing dictionary.
        const lastUpdatedDateCell = row.insertCell();
        lastUpdatedDateCell.classList.add('dd-last-updated-date-cell');
        lastUpdatedDateCell.textContent = existingRule.updated_at ? new Date(existingRule.updated_at).toLocaleDateString() : ''; // Display formatted date
        
        const updatedByCell = row.insertCell();
        updatedByCell.classList.add('dd-updated-by-cell');
        updatedByCell.textContent = existingRule.updated_by || ''; // Assuming 'updated_by' exists in rules_json if set

        const versionCell = row.insertCell();
        versionCell.classList.add('dd-version-cell');
        versionCell.textContent = existingRule.version || ''; // Assuming 'version' exists in rules_json if set


        // --- Pre-fill Existing Validation Rule ---
        // This needs to check for the existing 'Validation Type' from the 'validation_rules' array
        // Assuming existingRule.validation_rules is an array of validation objects, and we just use the first one for simplicity for pre-fill
        const existingValidationRule = (existingRule.validation_rules && existingRule.validation_rules.length > 0) ? existingRule.validation_rules[0] : null;

        if (existingValidationRule) {
            typeSelect.value = existingValidationRule.type || '';
            valueInput.value = existingValidationRule.value || '';
            messageInput.value = existingValidationRule.message || '';
            typeSelect.dispatchEvent(new Event('change')); // Trigger change to set initial visibility
        } else {
            // Ensure inputs are hidden if no existing rule
            valueInput.style.setProperty('display', 'none', 'important');
            valueInput.required = false;
            valueInput.placeholder = '';
            descriptionDiv.textContent = '';
        }


        typeSelect.addEventListener('change', (e) => {
            const selectedType = e.target.value;
            const input = e.target.closest('tr').querySelector('.validation-value-input');
            const descDiv = e.target.closest('tr').querySelector('.rule-description');

            input.value = ''; // Clear value when type changes
            descDiv.textContent = ''; // Clear description when type changes

            if (['ALLOWED_VALUES', 'NUMERIC_RANGE', 'REGEX'].includes(selectedType)) {
                input.style.setProperty('display', 'block', 'important');
                input.required = true;
                if (selectedType === 'ALLOWED_VALUES') {
                    input.placeholder = 'Comma-separated values (e.g., Apple,Orange)';
                    descDiv.textContent = 'Enter values separated by commas (e.g., "Yes,No").';
                } else if (selectedType === 'NUMERIC_RANGE') {
                    input.placeholder = 'Min-Max (e.g., 0-100)';
                    descDiv.textContent = 'Enter a numeric range (e.g., "1-100").';
                } else if (selectedType === 'REGEX') {
                    input.placeholder = 'Regular Expression (e.g., ^\\d{5}$ for 5 digits)';
                    descDiv.textContent = 'Enter a regular expression (e.g., "^\\d{5}$").';
                }
            } else {
                input.style.setProperty('display', 'none', 'important');
                input.required = false;
                input.placeholder = '';
                descriptionDiv.textContent = '';
            }

            if (selectedType === 'REQUIRED') {
                descDiv.textContent = 'Cell must not be empty.';
            } else if (selectedType === 'DATE_PAST') {
                descDiv.textContent = 'Date must be in the past.';
            } else if (selectedType === 'UNIQUE') {
                descDiv.textContent = 'Values in this column must be unique across the sheet.';
            }
        });
        // Manually trigger change for newly created elements to set initial display
        typeSelect.dispatchEvent(new Event('change'));
    });
    console.log("renderHeadersTable: Function finished rendering table."); // DEBUG
}


/**
 * Collects all defined rules from the headers table.
 * @returns {Array<object>} An array of rule objects, ready for saving.
 */
function collectRules() {
    console.log("collectRules: Starting collection from UI."); // DEBUG
    const rules = [];
    const tbody = document.querySelector('#headersTable tbody');
    if (!tbody) {
        console.error("collectRules: tbody element not found!");
        return [];
    }

    const rows = tbody.querySelectorAll('tr');
    rows.forEach(row => {
        // Extract original column name
        const columnName = row.cells[0].textContent.trim();

        // Extract new data dictionary fields
        // Note: Display Name input field collection is intentionally removed
        const description = row.querySelector('.dd-description').value.trim();
        const dataType = row.querySelector('.dd-data-type').value;
        const lengthSize = row.querySelector('.dd-length-size').value.trim();
        const format = row.querySelector('.dd-format').value.trim();
        const allowableValues = row.querySelector('.dd-allowable-values').value.trim();
        const nullability = row.querySelector('.dd-nullability').value;
        const sourceSystems = row.querySelector('.dd-source-systems').value.trim();
        const targetSystems = row.querySelector('.dd-target-systems').value.trim(); // Corrected variable name declaration
        const businessRules = row.querySelector('.dd-business-rules').value.trim();
        const relationship = row.querySelector('.dd-relationship').value.trim();
        const ownership = row.querySelector('.dd-ownership').value.trim();
        const securityClassification = row.querySelector('.dd-security-classification').value;

        // Extract validation rule fields
        const validationType = row.querySelector('.validation-type-select').value;
        const validationValueInput = row.querySelector('.validation-value-input');
        const validationValue = validationValueInput.style.display !== 'none' ? validationValueInput.value.trim() : "";
        const failureMessage = row.querySelector('.failure-message-input').value.trim();

        // Construct the comprehensive rule object
        const rule = {
            "Column Name": columnName, // Original header
            description: description,
            data_type: dataType,
            length_size: lengthSize,
            format: format,
            allowable_values: allowableValues,
            nullability: nullability,
            source_systems: sourceSystems,
            target_systems: targetSystems, // FIX: Use the correctly declared variable 'targetSystems'
            business_rules: businessRules,
            relationships: relationship,
            ownership: ownership,
            security_classification: securityClassification,
            validation_rules: [] // Array for validation rules
        };

        // Add validation rule if one is selected
        if (validationType && validationType !== '') {
            rule.validation_rules.push({
                type: validationType,
                value: validationValue,
                message: failureMessage
            });
        }

        rules.push(rule);
    });
    console.log("collectRules: Collected Comprehensive Rules:", rules); // DEBUG
    return rules;
}


/**
 * Handles saving a new data dictionary or updating an existing one.
 */
async function saveDataDictionary() {
    console.log("DEBUG: saveDataDictionary function started."); // ADDED DEBUG LOG
    const dictionaryNameInput = document.getElementById('dictionaryName');
    let dictionaryName = dictionaryNameInput.value.trim();

    // IMPORTANT: Collect rules for the CURRENTLY ACTIVE SHEET before saving
    // This ensures sheetRulesMap has the latest UI state for the current sheet
    if (currentSheetName) {
        const currentSheetRulesFromUI = collectRules();
        sheetRulesMap.set(currentSheetName, currentSheetRulesFromUI);
        console.log(`DEBUG: Saved current UI rules to sheetRulesMap for "${currentSheetName}":`, currentSheetRulesFromUI); // ADDED DEBUG LOG
    } else {
        console.warn("DEBUG: currentSheetName is null. Cannot save rules to sheetRulesMap."); // ADDED DEBUG LOG
    }

    // Now, get the rules for saving from the map
    const rulesToSave = sheetRulesMap.get(currentSheetName);
    if (!rulesToSave || rulesToSave.length === 0) {
        displayMessage('saveStatus', 'No rules defined for the current sheet to save.', 'error');
        console.error("DEBUG: No rules to save for current sheet. Aborting save."); // ADDED DEBUG LOG
        return;
    }

    // Get headers for the current sheet from the map
    const sourceHeadersToSave = sheetHeadersMap.get(currentSheetName);
    if (!sourceHeadersToSave || sourceHeadersToSave.length === 0) {
        displayMessage('saveStatus', 'Cannot save: No headers found for the current sheet.', 'error');
        console.error("DEBUG: No headers to save for current sheet. Aborting save."); // ADDED DEBUG LOG
        return;
    }


    if (!dictionaryName) {
        displayMessage('saveStatus', 'Please enter a name for your data dictionary.', 'error');
        dictionaryNameInput.focus();
        console.error("DEBUG: Dictionary name is empty. Aborting save."); // ADDED DEBUG LOG
        return;
    }
    
    // Ensure dictionary name includes sheet name for clarity and uniqueness
    // Only append if it doesn't already contain the sheet name (to avoid double appending)
    if (uploadedOriginalFileName && currentSheetName && !dictionaryName.includes(currentSheetName)) {
        dictionaryName = `${uploadedOriginalFileName.replace(/\.(xlsx|xls|csv)$/i, '').trim()} - ${currentSheetName}`;
        document.getElementById('dictionaryName').value = dictionaryName; // Update UI with full name
        console.log("saveDataDictionary: Auto-adjusted dictionary name to:", dictionaryName); // DEBUG
    } else if (!uploadedOriginalFileName && currentSheetName && !dictionaryName.includes(currentSheetName)) {
        // Fallback for loading from existing dict without original file name
        dictionaryName = `${dictionaryName.split(' - ')[0].trim()} - ${currentSheetName}`;
        document.getElementById('dictionaryName').value = dictionaryName; // Update UI with full name
        console.log("saveDataDictionary: Adjusted dictionary name for loaded dict to:", dictionaryName); // DEBUG
    }


    displayMessage('saveStatus', 'Saving data dictionary...', 'info');
    document.getElementById('saveDictionaryBtn').disabled = true;
    document.getElementById('printDictionaryBtn').disabled = true;

    const token = localStorage.getItem('jwtToken');
    if (!token) {
        displayMessage('saveStatus', 'Authentication required. Please log in again.', 'error');
        console.error("DEBUG: No JWT token found. Aborting save."); // ADDED DEBUG LOG
        document.getElementById('saveDictionaryBtn').disabled = false;
        document.getElementById('printDictionaryBtn').disabled = false;
        return;
    }

    const payload = {
        dictionaryName,
        rules: rulesToSave, // Changed to 'rules' to match backend's expected 'rules' field
        sourceHeaders: sourceHeadersToSave, // Changed to 'sourceHeaders'
        ...(isEditingExistingDictionary && currentDictionaryId && { id: currentDictionaryId })
    };
    console.log("DEBUG: Payload being sent:", payload); // ADDED DEBUG LOG

    try {
        console.log("DEBUG: Initiating fetch request to /api/save-data-dictionary"); // ADDED DEBUG LOG
        const response = await fetch('/api/save-data-dictionary', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(payload)
        });

        const result = await response.json();

        if (response.ok) {
            displayMessage('saveStatus', result.message || 'Data dictionary saved successfully!', 'success');
            if (!isEditingExistingDictionary && result.dictionaryId) {
                currentDictionaryId = result.dictionaryId;
                isEditingExistingDictionary = true;
            }
            await populateExistingDictionariesDropdown(); // Re-populate to show new/updated dict
            console.log("saveDataDictionary: Successfully saved and dropdown re-populated."); // DEBUG
        } else {
            displayMessage('saveStatus', `Error saving: ${result.message || 'Unknown error.'}`, 'error');
            console.error('Save error:', result.error || result.message); // DEBUG
        }
    } catch (error) {
        displayMessage('saveStatus', `Network error during save: ${error.message}`, 'error');
        console.error('Frontend save error:', error); // DEBUG
    } finally {
        document.getElementById('saveDictionaryBtn').disabled = false;
        document.getElementById('printDictionaryBtn').disabled = false;
    }
}

/**
 * NEW: Validates a single sheet's data against the defined rules.
 * @param {Array<Array<any>>} sheetData - The raw sheet data (array of arrays).
 * @param {Array<object>} rules - The data dictionary rules collected from the UI.
 * @returns {Array<object>} An array of validation error objects.
 */
function validateSheetData(sheetData, rules) {
    console.log("validateSheetData: Validating sheet. SheetData length:", sheetData ? sheetData.length : 0, "Rules length:", rules ? rules.length : 0); // DEBUG
    const errors = [];
    if (!sheetData || sheetData.length < 2) { // Need at least header row and one data row
        console.log("validateSheetData: No data rows found or sheet is empty."); // DEBUG
        return errors;
    }

    const headers = sheetData[0].map(h => String(h).trim()); // Actual headers from the sheet
    const dataRows = sheetData.slice(1); // All rows after the header

    // Create a map for quick lookup of rules by column name
    const rulesMap = new Map();
    rules.forEach(rule => {
        rulesMap.set(String(rule['Column Name']).trim(), rule);
    });
    console.log("validateSheetData: Headers from sheet:", headers); // DEBUG
    console.log("validateSheetData: Rules Map for validation:", rulesMap); // DEBUG

    dataRows.forEach((row, rowIndex) => {
        headers.forEach((header, colIndex) => {
            const cellValue = row[colIndex];
            const rule = rulesMap.get(header);

            if (!rule || !rule.validation_rules || rule.validation_rules.length === 0) {
                return; // No validation rules defined for this header
            }

            const validationRule = rule.validation_rules[0]; // Assuming one rule per column for validation

            const actualValue = (cellValue === null || cellValue === undefined) ? '' : String(cellValue).trim();
            let isValid = true;
            let errorMessage = validationRule.message || `Validation failed for column "${header}" with value "${actualValue}".`;

            // Skip validation if value is empty/whitespace AND rule is not 'REQUIRED'
            if (actualValue === '' && validationRule.type !== 'REQUIRED') {
                return;
            }

            switch (validationRule.type) {
                case 'REQUIRED':
                    if (actualValue === '') {
                        isValid = false;
                    }
                    break;
                case 'ALLOWED_VALUES':
                    if (validationRule.value) {
                        const allowedValues = validationRule.value.split(',').map(v => v.trim().toLowerCase());
                        if (!allowedValues.includes(actualValue.toLowerCase())) {
                            isValid = false;
                            errorMessage = validationRule.message || `Value "${actualValue}" not in allowed values: ${validationRule.value}.`;
                        }
                    } else { // If ALLOWED_VALUES type is selected but no values provided, it's an invalid rule setup
                        isValid = false;
                        errorMessage = `Allowed Values rule defined for "${header}" but no allowed values provided.`;
                    }
                    break;
                case 'NUMERIC_RANGE':
                    if (validationRule.value) {
                        const [minStr, maxStr] = validationRule.value.split('-').map(s => s.trim());
                        const min = parseFloat(minStr);
                        const max = parseFloat(maxStr);
                        const numValue = parseFloat(actualValue);

                        if (isNaN(numValue) || numValue < min || numValue > max || minStr === '' || maxStr === '') {
                            isValid = false;
                            errorMessage = validationRule.message || `Value "${actualValue}" is not a number or outside range ${validationRule.value}.`;
                        }
                    } else { // If NUMERIC_RANGE type is selected but no range provided
                        isValid = false;
                        errorMessage = `Numeric Range rule defined for "${header}" but no range provided.`;
                    }
                    break;
                case 'REGEX':
                    if (validationRule.value) {
                        try {
                            const regex = new RegExp(validationRule.value);
                            if (!regex.test(actualValue)) {
                                isValid = false;
                                errorMessage = validationRule.message || `Value "${actualValue}" does not match pattern: ${validationRule.value}.`;
                            }
                        } catch (e) {
                            isValid = false; // Invalid regex pattern itself is an error
                            errorMessage = `Invalid regex pattern for column "${header}": ${validationRule.value}. Error: ${e.message}`;
                            console.error(errorMessage, e);
                        }
                    } else { // If REGEX type is selected but no pattern provided
                        isValid = false;
                        errorMessage = `Regex rule defined for "${header}" but no pattern provided.`;
                    }
                    break;
                case 'DATE_PAST':
                    const date = new Date(actualValue);
                    const today = new Date();
                    today.setHours(0,0,0,0); // Compare dates, not times

                    if (isNaN(date.getTime()) || date >= today) {
                        isValid = false;
                        errorMessage = validationRule.message || `Date "${actualValue}" is not a valid date or is not in the past.`;
                    }
                    break;
                case 'UNIQUE':
                    // Unique validation is handled after the main loop for the entire column
                    break;
                case 'None':
                    // No specific validation, always valid based on this rule
                    break;
            }

            if (!isValid) {
                errors.push({
                    sheetName: "N/A", // Will be filled later
                    header: header,
                    rowIndex: rowIndex + 1, // +1 for 0-indexed dataRows, +1 for header row
                    colIndex: colIndex,
                    value: actualValue,
                    message: errorMessage
                });
            }
        });
    });

    // Special handling for 'UNIQUE' rule: needs to check entire column after all rows are processed
    rules.forEach(rule => {
        const colName = String(rule['Column Name']).trim();
        if (rule.validation_rules && rule.validation_rules.length > 0 && rule.validation_rules[0].type === 'UNIQUE') {
            const headerIndex = headers.indexOf(colName);
            if (headerIndex !== -1) {
                const columnValues = dataRows.map(row => (row[headerIndex] === null || row[headerIndex] === undefined) ? '' : String(row[headerIndex]).trim());
                const seenValues = new Set();
                columnValues.forEach((value, dataRowIdx) => {
                    if (value !== '' && seenValues.has(value)) { // Only check non-empty duplicates
                        errors.push({
                            sheetName: "N/A", // Will be filled later
                            header: colName,
                            rowIndex: dataRowIdx + 1, // Adjust to actual row number in dataRows
                            colIndex: headerIndex,
                            value: value,
                            message: rule.validation_rules[0].message || `Value "${value}" in column "${colName}" is not unique.`
                        });
                    } else if (value !== '') {
                        seenValues.add(value);
                    }
                });
            }
        }
    });
    console.log("validateSheetData: Validation finished. Errors found:", errors.length); // DEBUG
    return errors;
}


/**
 * Handles the printing of the current Data Dictionary and a validation report for all sheets
 * in the currently uploaded workbook.
 */
function handlePrintDictionary() {
    console.log("handlePrintDictionary: Starting."); // DEBUG
    const dictionaryName = document.getElementById('dictionaryName').value.trim();
    
    // Ensure rules from the current sheet are saved to map before generating report
    if (currentSheetName) {
        const currentSheetRulesFromUI = collectRules(); // Collect from UI for the sheet we are on
        sheetRulesMap.set(currentSheetName, currentSheetRulesFromUI); // Save to map
        console.log(`handlePrintDictionary: Saved current UI rules to sheetRulesMap for "${currentSheetName}":`, currentSheetRulesFromUI); // DEBUG
    }

    const rulesForCurrentSheet = sheetRulesMap.get(currentSheetName);

    if (!dictionaryName || !rulesForCurrentSheet || rulesForCurrentSheet.length === 0) {
        displayMessage('saveStatus', 'Please load or create a data dictionary with rules to print.', 'error');
        console.error("handlePrintDictionary: No dictionary name or rules for current sheet to print."); // DEBUG
        return;
    }

    if (!currentWorkbook) {
        displayMessage('saveStatus', 'No file uploaded for validation report. Please upload a file first.', 'error');
        console.error("handlePrintDictionary: No workbook uploaded."); // DEBUG
        return;
    }

    const printWindow = window.open('', '', 'height=800,width=1200'); // Larger print window
    if (!printWindow) {
        displayMessage('saveStatus', 'Please allow pop-ups for printing this report.', 'error');
        console.error("handlePrintDictionary: Pop-up blocked."); // DEBUG
        return;
    }

    let printContent = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Data Dictionary & Validation Report - ${dictionaryName}</title>
            <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
            <style>
                body {
                    font-family: 'Inter', sans-serif;
                    margin: 20px;
                    color: #333;
                    line-height: 1.6;
                    -webkit-print-color-adjust: exact;
                    print-color-adjust: exact;
                }
                h1 {
                    color: #2D62B3;
                    text-align: center;
                    margin-bottom: 20px;
                    font-size: 2.2em;
                }
                h2 {
                    color: #495057;
                    margin-top: 30px;
                    margin-bottom: 15px;
                    font-size: 1.8em;
                    border-bottom: 2px solid #ccc;
                    padding-bottom: 5px;
                }
                h3 {
                    color: #5a6268;
                    margin-top: 20px;
                    margin-bottom: 10px;
                    font-size: 1.4em;
                }
                .meta-info p {
                    margin: 5px 0;
                    font-size: 0.95em;
                }
                .meta-info strong {
                    color: #2c3e50;
                }
                table {
                    width: 100%;
                    border-collapse: collapse;
                    margin-bottom: 20px;
                    font-size: 0.8em;
                }
                th, td {
                    border: 1px solid #ddd;
                    padding: 8px;
                    text-align: left;
                    vertical-align: top;
                }
                th {
                    background-color: #f2f2f2;
                    font-weight: bold;
                    color: #555;
                }
                tr:nth-child(even) {
                    background-color: #f9f9f9;
                }
                .validation-summary {
                    margin-top: 15px;
                    padding: 10px;
                    border: 1px solid #e0e0e0;
                    border-radius: 5px;
                    background-color: #fdfdfd;
                }
                .validation-error {
                    color: #dc3545; /* Red for errors */
                    font-weight: 500;
                }
                .validation-success {
                    color: #28a745; /* Green for success */
                    font-weight: 500;
                }
                .error-list {
                    list-style-type: disc;
                    margin-left: 20px;
                    padding-left: 0;
                }
                .error-item {
                    margin-bottom: 5px;
                    color: #dc3545;
                }
                @media print {
                    body, h1, h2, h3, p, strong, table, th, td {
                        color: #000 !important;
                    }
                    body, table, tr, td {
                        background-color: #fff !important;
                    }
                    th {
                        background-color: #e0e0e0 !important;
                    }
                    .validation-error {
                        color: #dc3545 !important;
                    }
                    .validation-success {
                        color: #28a745 !important;
                    }
                }
            </style>
        </head>
        <body>
            <h1>Data Dictionary & Validation Report</h1>
            <div class="meta-info">
                <p><strong>Dictionary Name:</strong> ${dictionaryName}</p>
                <p><strong>Generated On:</strong> ${new Date().toLocaleString()}</p>
                <p><strong>Source File:</strong> ${uploadedOriginalFileName || 'N/A'}</p>
            </div>
            <h2>Defined Column Rules (For Current Sheet: "${currentSheetName || 'N/A'}")</h2>
            <table>
                <thead>
                    <tr>
                        <th>Column Name</th>
                        <th>Definition/Description</th>
                        <th>Data Type</th>
                        <th>Length/Size</th>
                        <th>Format</th>
                        <th>Allowable Values/Domain</th>
                        <th>Nullability</th>
                        <th>Source System(s)</th>
                        <th>Target System(s)/Usage</th>
                        <th>Business Rules/Constraints</th>
                        <th>Relationship to Other Elements/Tables</th>
                        <th>Ownership/Stewardship</th>
                        <th>Security Classification</th>
                        <th>Validation Type</th>
                        <th>Validation Value</th>
                        <th>Failure Message</th>
                        <th>Last Updated Date</th>
                        <th>Updated By</th>
                        <th>Version</th>
                    </tr>
                </thead>
                <tbody>
    `;

    rulesForCurrentSheet.forEach(rule => { // Use rulesForCurrentSheet for printing
        let validationType = 'None';
        let validationValue = '';
        let failureMessage = '';
        if (rule.validation_rules && rule.validation_rules.length > 0) {
            const valRule = rule.validation_rules[0];
            validationType = validationTypes.find(vt => vt.value === valRule.type)?.text || valRule.type;
            validationValue = valRule.value || '';
            failureMessage = valRule.message || '';
        }

        printContent += `
            <tr>
                <td>${rule['Column Name'] || ''}</td>
                <td>${rule.description || ''}</td>
                <td>${rule.data_type || ''}</td>
                <td>${rule.length_size || ''}</td>
                <td>${rule.format || ''}</td>
                <td>${rule.allowable_values || ''}</td>
                <td>${rule.nullability || ''}</td>
                <td>${rule.source_systems || ''}</td>
                <td>${rule.target_systems || ''}</td>
                <td>${rule.business_rules || ''}</td>
                <td>${rule.relationships || ''}</td>
                <td>${rule.ownership || ''}</td>
                <td>${rule.security_classification || ''}</td>
                <td>${validationType}</td>
                <td>${validationValue}</td>
                <td>${failureMessage}</td>
                <td>${rule.updated_at ? new Date(rule.updated_at).toLocaleDateString() : ''}</td>
                <td>${rule.updated_by || ''}</td>
                <td>${rule.version || ''}</td>
            </tr>
        `;
    });

    printContent += `
                </tbody>
            </table>
            <h2>Validation Results per Sheet</h2>
    `;
    console.log("handlePrintDictionary: Starting validation for all sheets in workbook."); // DEBUG

    // Perform validation for each sheet in the workbook
    currentWorkbook.SheetNames.forEach(sheetName => {
        // Use the rules from sheetRulesMap for each sheet if they exist, otherwise fallback to currentSheetRules
        const rulesToApplyForSheet = sheetRulesMap.get(sheetName) || rulesForCurrentSheet;
        
        const worksheet = currentWorkbook.Sheets[sheetName];
        const sheetData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: null });
        const validationErrors = validateSheetData(sheetData, rulesToApplyForSheet); // Pass appropriate rules for each sheet

        printContent += `
            <h3>Sheet: "${sheetName}"</h3>
            <div class="validation-summary">
        `;

        if (validationErrors.length === 0) {
            printContent += `<p class="validation-success">All validations passed for this sheet. No errors found.</p>`;
        } else {
            printContent += `<p class="validation-error">Found ${validationErrors.length} validation errors in this sheet:</p>`;
            printContent += `<ul class="error-list">`;
            validationErrors.forEach(error => {
                printContent += `
                    <li class="error-item">
                        <strong>Column:</strong> ${error.header} (Row: ${error.rowIndex}, Col: ${error.colIndex + 1})<br>
                        <strong>Value:</strong> "${error.value}"<br>
                        <strong>Error:</strong> ${error.message}
                    </li>
                `;
            });
            printContent += `</ul>`;
        }
        printContent += `</div>`;
    });
    console.log("handlePrintDictionary: Finished validation and report generation."); // DEBUG

    printContent += `
        </body>
        </html>
    `;

    printWindow.document.write(printContent);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
}

/**
 * Closes the full-screen data dictionary builder modal.
 */
function closeModal() {
    console.log("closeModal: Closing modal and resetting UI."); // DEBUG
    document.getElementById('dataDictionaryOverlay').classList.add('hidden');
    resetBuilderUI(); // Also resets the form and shows initial selection
}

/**
 * Resets the builder UI to its initial state (showing selection options).
 */
function resetBuilderUI() {
    console.log("resetBuilderUI: Resetting all global state and UI."); // DEBUG
    currentHeaders = [];
    currentDictionaryId = null;
    uploadedOriginalFileName = null;
    isEditingExistingDictionary = false;
    currentWorkbook = null; // Clear the workbook on UI reset
    currentSheetName = null; // Clear current sheet name
    sheetHeadersMap.clear(); // Clear sheet headers map
    sheetRulesMap.clear(); // Clear sheet rules map

    document.getElementById('dictionaryName').value = '';
    document.querySelector('#headersTable tbody').innerHTML = '';
    document.getElementById('saveDictionaryBtn').disabled = true;
    document.getElementById('printDictionaryBtn').disabled = true; // Disable print button on reset

    // Hide the overlay and show the initial selection section
    document.getElementById('dataDictionaryOverlay').classList.add('hidden'); // Ensure overlay is hidden
    document.getElementById('initialSelectionSection').classList.remove('hidden'); // Show initial choices

    // Also reset sheet selector dropdown
    const sheetSelector = document.getElementById('sheetSelector');
    if (sheetSelector) {
        sheetSelector.innerHTML = '<option value="">No file loaded</option>';
        sheetSelector.disabled = true;
    }

    displayMessage('existingDictStatus', '', 'info');
    displayMessage('newDictStatus', '', 'info');
    displayMessage('saveStatus', '', 'info');
    console.log("resetBuilderUI: Reset complete."); // DEBUG
}

// --- Event Listeners and Initial Load ---
document.addEventListener('DOMContentLoaded', async () => {
    console.log("DOMContentLoaded: Event fired. Starting initial setup."); // DEBUG
    const userData = await verifyToken();
    if (userData) {
        setupNavigation(userData);
        await populateExistingDictionariesDropdown();
    }

    document.getElementById('loadExistingDictionaryBtn').addEventListener('click', loadDictionaryForEditing);
    document.getElementById('createNewDictionaryBtn').addEventListener('click', startNewDictionaryFromUpload);
    document.getElementById('saveDictionaryBtn').addEventListener('click', saveDataDictionary);
    document.getElementById('printDictionaryBtn').addEventListener('click', handlePrintDictionary);

    const closeModalBtn = document.getElementById('closeModalBtn');
    if (closeModalBtn) {
        closeModalBtn.addEventListener('click', closeModal);
    }

    const sheetSelector = document.getElementById('sheetSelector');
    if (sheetSelector) {
        sheetSelector.addEventListener('change', handleSheetSelectionChange);
    }

    document.getElementById('existingDictionarySelect').addEventListener('change', () => {
        displayMessage('existingDictStatus', '', 'info');
    });

    document.getElementById('excelFile').addEventListener('change', () => {
        displayMessage('newDictStatus', '', 'info');
    });

    // Ensure the initial selection UI is visible when the page loads
    // and the overlay is hidden.
    resetBuilderUI();
    console.log("DOMContentLoaded: Initial setup complete."); // DEBUG
});
