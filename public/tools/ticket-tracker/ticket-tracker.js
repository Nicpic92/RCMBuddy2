/*
 * JavaScript for the Universal Ticket Tracker
 * Handles file parsing, data display, filtering, sorting, and printing.
 */

// --- Configuration for Universal Tracker ---
// This object defines configurable parameters for the tracker,
// allowing it to adapt to different Excel file structures and preferences.
const config = {
    appTitle: "Universal Ticket Tracker",
    // Define possible column names for key functionalities.
    // The tracker will try to find the first matching name in the uploaded data.
    columnMapping: {
        id: ['SR #', 'Ticket ID', 'ID', 'Ticket Number', 'Case ID', 'Case #', 'Service Request #'],
        status: ['Status', 'Ticket Status', 'Resolution Status', 'State', 'Progress'],
        activityDescription: ['Activity Description', 'Description', 'Summary', 'Subject', 'Title', 'Task'],
        notes: ['Notes / Action Items', 'Notes', 'Remarks', 'Action Items', 'Comments'],
        startDate: ['Start Date', 'Created Date', 'Date Opened'],
        etaDate: ['ETA for Completion', 'ETA Date', 'Due Date', 'Target Date'],
        completionDate: ['Completion Date', 'Closed Date', 'Resolved Date'],
        sharePointLink: ['SharePoint Link', 'Link', 'URL', 'Attachment Link', 'Reference'],
        priority: ['Priority', 'Severity', 'Impact', 'Urgency'],
        plan: ['Plan', 'Project', 'Program', 'Initiative'],
        assignedTo: ['Assigned To', 'Owner', 'Responsible'] // Added for filtering
    },
    // Status keywords that are generally considered "done" or "not active"
    // This list is now *only* used for defining which statuses *can* be excluded
    // by checkboxes, not for default exclusion in UI.
    defaultExcludedStatusesForSummary: ['complete', 'closed', 'resolved', 'archive', 'monitor', 'ongoing monitoring'],
    // Map priority keywords to numeric values for sorting (lower number = higher priority).
    // This allows consistent sorting regardless of textual priority names.
    priorityLevels: { 'critical': 0, 'high': 1, 'urgent': 1, 'medium': 2, 'moderate': 2, 'low': 3, 'minor': 3 }
};

// Global variables to store application state
let workbookData = {}; // Stores all sheet data from the loaded Excel file
const storageKey = 'universalTrackerWorkbookData'; // Key for localStorage
let sortDirections = {}; // Tracks sort direction for each column in each sheet
let currentActiveTabName = ''; // Name of the currently active sheet tab

let mainDataSheetName = null; // Dynamically identified name of the primary data sheet
let mainIdColumn = null; // NEW: Stores the user-selected main ID column
let columnHeaders = []; // Dynamically identified headers for the main data sheet
let allSheetNames = []; // Stores all sheet names from the loaded workbook

// Mapped column keys based on found headers from the current main data sheet.
// These will hold the *actual* header names found in the Excel file.
let ID_COLUMN_KEY = null;
let STATUS_COLUMN_KEY = null;
let ACTIVITY_DESCRIPTION_KEY = null;
let NOTES_COLUMN_KEY = null;
let START_DATE_KEY = null;
let ETA_COLUMN_KEY = null;
let COMPLETION_DATE_KEY = null;
let SHAREPOINT_LINK_KEY = null;
let PRIORITY_COLUMN_KEY = null;
let PLAN_COLUMN_KEY = null;
let ASSIGNED_TO_COLUMN_KEY = null; // Added for filtering

/**
 * Attempts to find the actual column name from a list of possible names
 * based on the `columnHeaders` of the main data sheet.
 * @param {Array<string>} possibleNames - An array of potential header names.
 * @returns {string|null} The matched header name, or null if not found.
 */
function findColumnName(possibleNames) {
    if (!columnHeaders || columnHeaders.length === 0) return null;
    for (const name of possibleNames) {
        if (columnHeaders.includes(name)) {
            return name;
        }
    }
    return null;
}

/**
 * Loads saved workbook data and UI state from localStorage.
 * This function is called on `<body>` load.
 */
function loadSavedData() {
    const savedData = localStorage.getItem(storageKey);
    const statusDiv = document.getElementById('status');
    if (savedData) {
        const parsedData = JSON.parse(savedData);
        workbookData = parsedData.workbookData;
        mainDataSheetName = parsedData.mainDataSheetName;
        columnHeaders = parsedData.columnHeaders;
        sortDirections = parsedData.sortDirections || {};
        allSheetNames = Object.keys(workbookData); // Populate allSheetNames from loaded data
        mainIdColumn = parsedData.mainIdColumn || null; // NEW: Load saved main ID column

        // Re-map column keys after loading saved data
        mapColumnHeaders(); // This will also call populateMainIdSelect
        populateMainSheetSelect(allSheetNames); // Populate the sheet selection dropdown

        statusDiv.innerHTML = `Displaying current report data from your last session. To update, load a new file.`;
        document.getElementById('statusFiltersContainer').style.display = 'block';
        document.getElementById('sheetSelectionContainer').style.display = 'block'; // Show sheet selection
        document.getElementById('mainIdSelectionContainer').style.display = 'block'; // NEW: Show main ID selection
        // Only show print filters if main data exists
        document.getElementById('printFiltersContainer').style.display = (mainDataSheetName && workbookData[mainDataSheetName]?.data.length > 0) ? 'block' : 'none';
        displayUI();
    } else {
        statusDiv.textContent = 'No current report data saved. Please load an Excel file to get started.';
        document.getElementById('statusFiltersContainer').style.display = 'none';
        document.getElementById('printFiltersContainer').style.display = 'none';
        document.getElementById('sheetSelectionContainer').style.display = 'none'; // Hide sheet selection
        document.getElementById('mainIdSelectionContainer').style.display = 'none'; // NEW: Hide main ID selection
    }
    togglePrintButtonVisibility(); // Ensure print button state is correct on load
}

/**
 * Clears all saved workbook data from localStorage and resets the UI.
 */
function clearSavedData() {
    // Using a simple confirmation dialog (as per original code,
    // though custom modals are preferred in Canvas for full control)
    if (confirm("Are you sure you want to clear all current report data?")) {
        localStorage.removeItem(storageKey);
        workbookData = {};
        sortDirections = {};
        mainDataSheetName = null;
        mainIdColumn = null; // NEW: Clear main ID column
        columnHeaders = []; // Clear headers too
        allSheetNames = []; // Clear sheet names
        
        document.getElementById('status').textContent = 'Current report data has been cleared. Please load a file.';
        document.getElementById('main-content').style.display = 'none';
        document.getElementById('statusFiltersContainer').style.display = 'none';
        document.getElementById('printFiltersContainer').style.display = 'none';
        document.getElementById('sheetSelectionContainer').style.display = 'none'; // Hide sheet selection
        document.getElementById('mainIdSelectionContainer').style.display = 'none'; // NEW: Hide main ID selection
        document.getElementById('tabButtons').innerHTML = '';
        document.getElementById('tabContent').innerHTML = '';
        document.getElementById('dynamicStatusCheckboxes').innerHTML = ''; // Clear dynamic main status filters
        document.getElementById('dynamicPrintStatusCheckboxes').innerHTML = ''; // Clear dynamic print status filters
        document.getElementById('printPriorityFilterInput').innerHTML = '<option value="">All</option>'; // Reset print priority filter
        document.getElementById('printAssignedToFilterInput').value = ''; // Clear print assigned to filter
        document.getElementById('printSortByInput').innerHTML = '<option value="">Default Sorting</option>'; // Reset print sort by filter
        currentActiveTabName = ''; // Reset active tab
        document.getElementById('mainSheetSelect').innerHTML = ''; // Clear sheet select options
        document.getElementById('mainIdSelect').innerHTML = ''; // NEW: Clear main ID select options
    }
    togglePrintButtonVisibility(); // Ensure print button state is correct after clearing
}

// Add event listener for file input change
document.getElementById('fileInput').addEventListener('change', handleFile, false);

/**
 * Handles the file selection event. Reads the Excel file and processes it.
 * @param {Event}} e - The file input change event.
 */
function handleFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    document.getElementById('status').textContent = `Loading new report: ${file.name}...`;
    const reader = new FileReader();
    reader.onload = function(event) {
        const data = new Uint8Array(event.target.result);
        // Use XLSX.read to parse the Excel file
        const workbook = XLSX.read(data, {type: 'array'});
        allSheetNames = workbook.SheetNames; // Store all sheet names globally
        processWorkbook(workbook);
    };
    reader.readAsArrayBuffer(file);
}

/**
 * Processes the loaded Excel workbook, extracts data, and stores it.
 * Dynamically identifies the main data sheet and its headers.
 * @param {Object} workbook - The XLSX.js workbook object.
 */
function processWorkbook(workbook) {
    workbookData = {}; // Reset workbook data
    sortDirections = {}; // Reset sort directions
    mainDataSheetName = null; // Reset main sheet name
    mainIdColumn = null; // NEW: Reset main ID column
    columnHeaders = []; // Reset column headers

    // Iterate through all sheets in the workbook
    for (const sheetName of workbook.SheetNames) {
        const worksheet = workbook.Sheets[sheetName];
        // Convert sheet to JSON, preserving raw values and using arrays for rows
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });

        let headerRowIndex = -1;
        
        // Attempt to find a header row: the first row with any non-empty cell.
        // This makes the tracker universal by not relying on a fixed header row.
        for (let i = 0; i < jsonData.length; i++) {
            if (jsonData[i].some(cell => cell !== null && String(cell).trim() !== '')) {
                headerRowIndex = i;
                break;
            }
        }

        if (headerRowIndex !== -1) {
            // Extract headers from the identified header row, trimming whitespace and filtering empty strings
            const headers = jsonData[headerRowIndex].map(h => String(h).trim()).filter(h => h !== '');
            const dataRows = jsonData.slice(headerRowIndex + 1); // Data starts after the header row

            // Map data rows to objects using the extracted headers
            const rows = dataRows.map(row => {
                const rowData = {};
                headers.forEach((header, index) => {
                    // Ensure the header exists before assigning value
                    if (header) { 
                        rowData[header] = row[index];
                    }
                });
                // Filter out completely empty rows (rows where all values are null/empty after mapping)
                return rowData;
            }).filter(row => Object.keys(row).length > 0 && Object.values(row).some(val => val !== null && String(val).trim() !== ''));

            // Store processed data and headers for the current sheet
            workbookData[sheetName] = {
                data: rows,
                headers: headers
            };
        } else {
             // If no headers/data found, store empty arrays
             workbookData[sheetName] = {
                data: [],
                headers: []
            };
        }
    }

    // After processing all sheets, set the main data sheet based on criteria
    // Default to the first sheet with data if no previous selection or invalid selection
    let defaultMainSheet = allSheetNames.find(name => workbookData[name]?.data.length > 0);
    if (defaultMainSheet) {
        mainDataSheetName = defaultMainSheet;
        columnHeaders = workbookData[mainDataSheetName].headers;
        // NEW: Try to find a default ID column, otherwise set to the first header
        ID_COLUMN_KEY = findColumnName(config.columnMapping.id);
        if (!ID_COLUMN_KEY && columnHeaders.length > 0) {
            ID_COLUMN_KEY = columnHeaders[0]; // Fallback to the first header if no recognized ID column
        }
        mainIdColumn = ID_COLUMN_KEY; // Set mainIdColumn to the determined default
    } else {
        mainDataSheetName = null;
        columnHeaders = [];
        ID_COLUMN_KEY = null;
        mainIdColumn = null;
    }

    // Populate sheet selection dropdown and main ID selection dropdown
    populateMainSheetSelect(allSheetNames);
    populateMainIdSelect(columnHeaders); // NEW: Populate main ID dropdown after headers are set
    document.getElementById('sheetSelectionContainer').style.display = 'block'; // Show sheet selection
    document.getElementById('mainIdSelectionContainer').style.display = 'block'; // NEW: Show main ID selection

    // Save the processed data to localStorage
    saveToLocalStorage();
    displayUI(); // Update the user interface with the new data
    togglePrintButtonVisibility(); // Ensure print button state is correct after processing
}

/**
 * Saves current workbookData and relevant state to localStorage.
 */
function saveToLocalStorage() {
    try {
        localStorage.setItem(storageKey, JSON.stringify({
            workbookData: workbookData,
            mainDataSheetName: mainDataSheetName,
            columnHeaders: columnHeaders,
            sortDirections: sortDirections,
            mainIdColumn: mainIdColumn // NEW: Save mainIdColumn
        }));
        document.getElementById('status').textContent = `Successfully processed new report.`;
        document.getElementById('printFiltersContainer').style.display = (mainDataSheetName && workbookData[mainDataSheetName]?.data.length > 0) ? 'block' : 'none';
    } catch (error) {
        console.error("Error saving to localStorage:", error);
        document.getElementById('status').textContent = "Could not save new report to browser storage. Data might be too large. (See console for details)";
    }
}


/**
 * Populates the main sheet selection dropdown with names of all sheets from the loaded workbook.
 * @param {Array<string>} sheetNames - An array of all sheet names.
 */
function populateMainSheetSelect(sheetNames) {
    const selectElement = document.getElementById('mainSheetSelect');
    selectElement.innerHTML = ''; // Clear existing options

    // Add options for each sheet name
    sheetNames.forEach(name => {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name;
        selectElement.appendChild(option);
    });

    // Set the currently selected main sheet if one is already identified
    if (mainDataSheetName) {
        selectElement.value = mainDataSheetName;
    }
}

/**
 * Handles the selection of a new main report sheet from the dropdown.
 * @param {string} selectedSheetName - The name of the sheet selected by the user.
 */
function handleSheetSelection(selectedSheetName) {
    mainDataSheetName = selectedSheetName;
    // Update columnHeaders based on the newly selected main sheet
    columnHeaders = workbookData[mainDataSheetName]?.headers || [];
    
    // NEW: Reset ID_COLUMN_KEY and mainIdColumn as headers have changed
    ID_COLUMN_KEY = null; 
    mainIdColumn = null;

    mapColumnHeaders(); // Re-map column keys based on the new headers (this calls populateMainIdSelect)
    
    // If after re-mapping, ID_COLUMN_KEY is still null (no recognized ID column found),
    // and there are headers, default to the first header as the ID.
    if (!ID_COLUMN_KEY && columnHeaders.length > 0) {
        ID_COLUMN_KEY = columnHeaders[0];
        mainIdColumn = ID_COLUMN_KEY;
    } else if (ID_COLUMN_KEY) { // If a recognized ID was found, use it
        mainIdColumn = ID_COLUMN_KEY;
    }


    saveToLocalStorage(); // Save the new main sheet selection and updated mainIdColumn
    displayUI(); // Re-render the UI with the new main sheet
    togglePrintButtonVisibility(); // Update print button visibility
}

/**
 * NEW: Populates the main ID selection dropdown with headers from the current main sheet.
 * @param {Array<string>} headers - An array of headers from the main data sheet.
 */
function populateMainIdSelect(headers) {
    const selectElement = document.getElementById('mainIdSelect');
    selectElement.innerHTML = ''; // Clear existing options

    if (!headers || headers.length === 0) {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = 'No headers available';
        selectElement.appendChild(option);
        return;
    }

    headers.forEach(header => {
        const option = document.createElement('option');
        option.value = header;
        option.textContent = header;
        selectElement.appendChild(option);
    });

    // Set the dropdown to the currently identified main ID column
    if (mainIdColumn && headers.includes(mainIdColumn)) {
        selectElement.value = mainIdColumn;
        ID_COLUMN_KEY = mainIdColumn; // Ensure ID_COLUMN_KEY reflects selection
    } else if (headers.length > 0) {
        // If mainIdColumn is not set or not found in new headers, default to the first header
        selectElement.value = headers[0];
        mainIdColumn = headers[0];
        ID_COLUMN_KEY = headers[0];
    } else {
        // No headers at all
        ID_COLUMN_KEY = null;
        mainIdColumn = null;
    }
}

/**
 * NEW: Handles the selection of a new main ID column from the dropdown.
 * @param {string} selectedIdColumn - The name of the column selected as the main ID.
 */
function handleMainIdSelection(selectedIdColumn) {
    mainIdColumn = selectedIdColumn;
    ID_COLUMN_KEY = selectedIdColumn; // Update the global ID_COLUMN_KEY
    saveToLocalStorage(); // Save the new main ID selection
    displayUI(); // Re-render the UI to reflect the new grouping
}


/**
 * Maps generic column keys (e.g., 'ID', 'Status') to the actual
 * header names found in the loaded Excel file, using the `config.columnMapping`.
 * This makes the tracker universal.
 */
function mapColumnHeaders() {
    // These mappings are now primarily for fallback and specialized logic (e.g., date formatting)
    // ID_COLUMN_KEY is now controlled by `mainIdColumn` selection
    STATUS_COLUMN_KEY = findColumnName(config.columnMapping.status);
    ACTIVITY_DESCRIPTION_KEY = findColumnName(config.columnMapping.activityDescription);
    NOTES_COLUMN_KEY = findColumnName(config.columnMapping.notes);
    START_DATE_KEY = findColumnName(config.columnMapping.startDate);
    ETA_COLUMN_KEY = findColumnName(config.columnMapping.etaDate);
    COMPLETION_DATE_KEY = findColumnName(config.columnMapping.completionDate);
    SHAREPOINT_LINK_KEY = findColumnName(config.columnMapping.sharePointLink);
    PRIORITY_COLUMN_KEY = findColumnName(config.columnMapping.priority);
    PLAN_COLUMN_KEY = findColumnName(config.columnMapping.plan);
    ASSIGNED_TO_COLUMN_KEY = findColumnName(config.columnMapping.assignedTo);
    
    // Always repopulate main ID select here to ensure it's up to date with current headers
    populateMainIdSelect(columnHeaders); 

    // Regenerate other dynamic filter options based on the newly mapped column keys
    generateStatusFilters(); // For main view
    generatePrintStatusFilters(); // For print view
    generatePriorityFilter(); // For print view
    generatePrintSortByOptions(); // For print view
}

/**
 * Dynamically generates the "Hide Status" checkboxes for the main view based on unique
 * status values found in the loaded data.
 */
function generateStatusFilters() {
    const statusFilterContainer = document.getElementById('dynamicStatusCheckboxes');
    statusFilterContainer.innerHTML = ''; // Clear existing checkboxes

    // Only generate if a STATUS_COLUMN_KEY is identified and main data exists
    if (STATUS_COLUMN_KEY && mainDataSheetName && workbookData[mainDataSheetName] && workbookData[mainDataSheetName].data.length > 0) {
        // Get all status values, convert to lowercase, trim, and get unique values
        const allStatuses = workbookData[mainDataSheetName].data.map(item => String(item[STATUS_COLUMN_KEY] || '').trim().toLowerCase());
        const uniqueStatuses = [...new Set(allStatuses)].filter(s => s !== ''); // Filter out empty strings

        // Sort statuses alphabetically for consistent display
        uniqueStatuses.sort();

        uniqueStatuses.forEach(status => {
            const label = document.createElement('label');
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            // Create a unique ID for each checkbox
            checkbox.id = `hideStatus-${status.replace(/\s+/g, '-')}`; 
            checkbox.dataset.statusValue = status; // Store the original status value
            checkbox.onchange = applyAllFilters; // Attach filter handler
            label.appendChild(checkbox);
            // Capitalize the first letter for display
            label.appendChild(document.createTextNode(` Hide ${status.charAt(0).toUpperCase() + status.slice(1)}`));
            statusFilterContainer.appendChild(label);
        });
    }
}

/**
 * Dynamically generates the "Hide Status" checkboxes specifically for the print view.
 */
function generatePrintStatusFilters() {
    const printStatusFilterContainer = document.getElementById('dynamicPrintStatusCheckboxes');
    printStatusFilterContainer.innerHTML = ''; // Clear existing checkboxes

    if (STATUS_COLUMN_KEY && mainDataSheetName && workbookData[mainDataSheetName] && workbookData[mainDataSheetName].data.length > 0) {
        const allStatuses = workbookData[mainDataSheetName].data.map(item => String(item[STATUS_COLUMN_KEY] || '').trim().toLowerCase());
        const uniqueStatuses = [...new Set(allStatuses)].filter(s => s !== '');

        uniqueStatuses.sort();

        uniqueStatuses.forEach(status => {
            const label = document.createElement('label');
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.id = `printHideStatus-${status.replace(/\s+/g, '-')}`;
            checkbox.dataset.statusValue = status;
            checkbox.onchange = togglePrintButtonVisibility; // Update print button visibility on change
            label.appendChild(checkbox);
            label.appendChild(document.createTextNode(` ${status.charAt(0).toUpperCase() + status.slice(1)}`));
            printStatusFilterContainer.appendChild(label);
        });
    }
}

/**
 * Dynamically generates options for the "Priority" filter dropdown in the print view.
 */
function generatePriorityFilter() {
    const prioritySelect = document.getElementById('printPriorityFilterInput');
    prioritySelect.innerHTML = '<option value="">All</option>'; // Default "All" option

    if (PRIORITY_COLUMN_KEY && mainDataSheetName && workbookData[mainDataSheetName] && workbookData[mainDataSheetName].data.length > 0) {
        const allPriorities = workbookData[mainDataSheetName].data.map(item => String(item[PRIORITY_COLUMN_KEY] || '').trim().toLowerCase());
        const uniquePriorities = [...new Set(allPriorities)].filter(s => s !== '');

        // Sort priorities based on the config.priorityLevels mapping
        uniquePriorities.sort((a, b) => {
            const levelA = config.priorityLevels[a] !== undefined ? config.priorityLevels[a] : Infinity;
            const levelB = config.priorityLevels[b] !== undefined ? config.priorityLevels[b] : Infinity;
            return levelA - levelB;
        });

        // Add "Needs Priority!" if any item has an empty priority
        const hasEmptyPriority = workbookData[mainDataSheetName].data.some(item => 
            !item[PRIORITY_COLUMN_KEY] || String(item[PRIORITY_COLUMN_KEY]).trim() === ''
        );
        if (hasEmptyPriority) {
            const option = document.createElement('option');
            option.value = 'needs priority!';
            option.textContent = 'Needs Priority!';
            prioritySelect.appendChild(option);
        }

        uniquePriorities.forEach(priority => {
            const option = document.createElement('option');
            option.value = priority;
            option.textContent = priority.charAt(0).toUpperCase() + priority.slice(1);
            prioritySelect.appendChild(option);
        });
    }
}

/**
 * Dynamically generates options for the "Sort by" filter dropdown in the print view.
 */
function generatePrintSortByOptions() {
    const sortBySelect = document.getElementById('printSortByInput');
    sortBySelect.innerHTML = '<option value="">Default Sorting</option>'; // Default "Default Sorting" option

    if (mainDataSheetName && workbookData[mainDataSheetName] && workbookData[mainDataSheetName].data.length > 0) {
        const headers = workbookData[mainDataSheetName].headers;
        headers.forEach(header => {
            const option = document.createElement('option');
            option.value = header;
            option.textContent = header;
            sortBySelect.appendChild(option);
        });
    }
}


/**
 * Displays the main UI, including tab buttons and initial content.
 * Dynamically creates tabs for the Summary view and all sheets with headers.
 */
function displayUI() {
    const tabButtonsContainer = document.getElementById('tabButtons');
    const tabContentContainer = document.getElementById('tabContent');
    tabButtonsContainer.innerHTML = ''; // Clear existing tabs
    tabContentContainer.innerHTML = ''; // Clear existing tab content

    let displayableTabs = [];
    // Only display summary if main data sheet has data AND a main ID column is selected
    const hasMainData = mainDataSheetName && workbookData[mainDataSheetName] && workbookData[mainDataSheetName].data.length > 0 && ID_COLUMN_KEY;

    if (hasMainData) {
        displayableTabs.push('Summary');
    }

    // Add tabs for all other sheets that have headers defined
    // Filter out sheets that don't have data OR don't have headers
    for (const sheetName of allSheetNames) { // Use allSheetNames as the source for tabs
        if (workbookData[sheetName]?.headers.length > 0 && sheetName !== mainDataSheetName) {
            displayableTabs.push(sheetName);
        }
    }
    
    // Remove any potential duplicates (though unlikely with current logic, good practice)
    displayableTabs = [...new Set(displayableTabs)];

    // If no displayable tabs (no data found anywhere), show an error message
    if (displayableTabs.length === 0 ) {
        document.getElementById('main-content').style.display = 'none';
        document.getElementById('statusFiltersContainer').style.display = 'none';
        document.getElementById('printFiltersContainer').style.display = 'none';
        document.getElementById('sheetSelectionContainer').style.display = 'none'; // Hide sheet selection if no data
        document.getElementById('mainIdSelectionContainer').style.display = 'none'; // Hide main ID selection if no data
        let errorMessage = `No sheets with data found in the loaded file. Please ensure your Excel file has at least one sheet with data and a clear header row.`;
        document.getElementById('status').innerHTML = errorMessage;
        return;
    }

    // Show main content and filter containers if data is present
    document.getElementById('main-content').style.display = 'block';
    document.getElementById('statusFiltersContainer').style.display = 'block';
    document.getElementById('sheetSelectionContainer').style.display = 'block'; // Show sheet selection
    document.getElementById('mainIdSelectionContainer').style.display = 'block'; // Show main ID selection
    document.getElementById('printFiltersContainer').style.display = hasMainData ? 'block' : 'none'; // Print depends on main data and ID
    document.getElementById('status').textContent = 'Current report data loaded. Select a tab to view.';
    
    // Create tab buttons and corresponding content panes
    displayableTabs.forEach(tabName => {
        const button = document.createElement('button');
        button.textContent = tabName;
        button.onclick = () => showTab(tabName);
        tabButtonsContainer.appendChild(button);
        
        const pane = document.createElement('div');
        pane.id = `content-${tabName.replace(/\s+/g, '-')}`;
        pane.className = 'tab-pane';
        tabContentContainer.appendChild(pane);
    });

    // Set the default active tab
    const defaultTab = hasMainData ? 'Summary' : displayableTabs[0];
    if (currentActiveTabName && displayableTabs.includes(currentActiveTabName)) {
        // If a tab was active before, try to reactivate it
        showTab(currentActiveTabName);
    } else if (defaultTab) {
        // Otherwise, activate the default tab
        showTab(defaultTab);
    }
}

/**
 * Gets a comparable string value for a given field for filtering or sorting.
 * Handles Excel date serial numbers and special 'needs attention' text.
 * @param {*} value - The raw cell value.
 * @param {string} fieldName - The header name of the column.
 * @returns {string} The comparable string value.
 */
function getComparableValue(value, fieldName) {
    if (value === null || value === undefined) return "";
    
    // Convert Excel date serial numbers to readable strings for consistent comparison
    if ([START_DATE_KEY, COMPLETION_DATE_KEY, ETA_COLUMN_KEY].includes(fieldName) && typeof value === 'number' && value > 20000) {
        // Excel's epoch starts Jan 1, 1900. JS epoch starts Jan 1, 1970. 25569 is the difference in days.
        return new Date(Math.round((value - 25569) * 86400 * 1000)).toLocaleDateString();
    }
    
    // Handle special "needs attention" messages for filtering
    if (fieldName === ETA_COLUMN_KEY && String(value).trim() === '') {
        return "NEEDS ETA!";
    }
    if (fieldName === STATUS_COLUMN_KEY && String(value).trim() === '') {
        return "NEEDS STATUS!";
    }
    if (fieldName === PRIORITY_COLUMN_KEY && String(value).trim() === '') {
        return "NEEDS PRIORITY!";
    }
    // For notes, flatten multi-line text to a single string for filtering
    if (fieldName === NOTES_COLUMN_KEY) {
        return String(value).split(/\r\n|\r|\n/).map(r => r.trim()).filter(r => r !== '').join('\n');
    }
    // Default to trimmed string for all other values
    return String(value).trim();
}

/**
 * Formats a raw cell value for display in the UI.
 * Applies special formatting for dates, 'needs attention' items, and bulleted notes.
 * @param {*} value - The raw cell value.
 * @param {string} fieldName - The header name of the column.
 * @param {number} [maxBulletPoints=Infinity] - Maximum number of bullet points to display for notes.
 * @returns {string} The HTML string or formatted text for display.
 */
function formatForDisplay(value, fieldName, maxBulletPoints = Infinity) {
    // Format dates for display
    if ([START_DATE_KEY, COMPLETION_DATE_KEY].includes(fieldName)) {
        if (typeof value === 'number' && value > 20000) {
            const jsDate = new Date(Math.round((value - 25569) * 86400 * 1000));
            return jsDate.toLocaleDateString(); // Formats to local date string
        }
        return value ?? ''; // Return empty string for null/undefined
    }
    
    // Special formatting for ETA column
    if (fieldName === ETA_COLUMN_KEY) {
        if (typeof value === 'number' && value > 20000) {
            const jsDate = new Date(Math.round((value - 25569) * 86400 * 1000));
            return jsDate.toLocaleDateString();
        } else if (value === null || value === undefined || String(value).trim() === '') {
            return `<span class="needs-attention">NEEDS ETA!</span>`;
        }
        return value;
    }
    // Special formatting for Status column
    if (fieldName === STATUS_COLUMN_KEY) {
        if (value === null || value === undefined || String(value).trim() === '') {
            return `<span class="needs-attention">NEEDS STATUS!</span>`;
        }
        return value;
    }
    // Special formatting for Priority column
    if (fieldName === PRIORITY_COLUMN_KEY) {
        if (value === null || value === undefined || String(value).trim() === '') {
            return `<span class="needs-attention">NEEDS PRIORITY!</span>`;
        }
        return value;
    }
    // Format notes as an unordered list (bullet points)
    if (fieldName === NOTES_COLUMN_KEY && (value !== null && value !== undefined && String(value).trim() !== '')) {
        let remarksArray = String(value).split(/\r\n|\r|\n/).filter(r => r.trim() !== ''); // Split by newlines and filter empty lines
        
        // Limit the number of bullet points if maxBulletPoints is set
        if (maxBulletPoints < remarksArray.length) {
            remarksArray = remarksArray.slice(0, maxBulletPoints);
            remarksArray.push('... (more)'); // Indicate truncation
        }

        let remarksHtml = '<ul>';
        remarksArray.forEach(remark => {
            remarksHtml += `<li>${remark.trim()}</li>`;
        });
        remarksHtml += '</ul>';
        return remarksHtml;
    }
    // Default return for any other value
    return value ?? '';
}

/**
 * Generates the HTML for a data table based on a given sheet.
 * Includes dynamic headers, sort arrows, and filter inputs.
 * @param {string} sheetName - The name of the sheet to generate the table for.
 * @returns {string} The HTML string for the table.
 */
function generateTableHTML(sheetName) {
    const sheetInfo = workbookData[sheetName];
    if (!sheetInfo || !sheetInfo.data || sheetInfo.data.length === 0 || sheetInfo.headers.length === 0) {
        return '<p>This sheet has no data rows or headers to display.</p>';
    }
    const sheetData = sheetInfo.data;
    const headers = sheetInfo.headers;

    let tableHTML = '<table><thead><tr>';
    // Create table headers with sort functionality
    headers.forEach(header => {
        tableHTML += `<th data-header-name="${header}">
                                <span class="header-text" onclick="sortTable('${sheetName}', '${header}')">
                                    ${header} <span class="sort-arrow">&#x25B2;&#x25BC;</span>
                                </span>
                               </th>`;
    });
    tableHTML += '</tr><tr>';
    // Create filter inputs for each column
    headers.forEach(header => {
        tableHTML += `<th>
                                <input type="text" class="column-filter"
                                        data-column-header="${header}"
                                        oninput="applyAllFilters()"
                                        placeholder="Filter ${header}...">
                               </th>`;
    });
    tableHTML += '</tr></thead><tbody>';

    // Populate table rows with data
    sheetData.forEach((row, rowIndex) => {
        tableHTML += '<tr>';
        headers.forEach(header => {
            // Use formatForDisplay to handle special values
            let cellDisplayValue = formatForDisplay(row[header], header, Infinity); // No bullet point limit for table view
            tableHTML += `<td>${cellDisplayValue}</td>`;
        });
        tableHTML += '</tr>';
    });
    tableHTML += '</tbody></table>';
    return tableHTML;
}

/**
 * Generates the HTML for the filter inputs displayed above the Summary view.
 * Includes a filter input for every header found in the main data sheet.
 * @returns {string} The HTML string for the summary filter inputs.
 */
function generateSummaryFilterInputsHTML() {
    if (!mainDataSheetName || !workbookData[mainDataSheetName] || workbookData[mainDataSheetName].data.length === 0) return '';

    const headers = workbookData[mainDataSheetName].headers;
    let filtersHTML = '<div class="summary-filters-container">';
    headers.forEach(fieldKey => {
        filtersHTML += `<input type="text" class="summary-field-filter"
                                        data-filter-key="${fieldKey}"
                                        oninput="applyAllFilters()"
                                        placeholder="Filter ${fieldKey}...">`;
    });
    filtersHTML += '</div>';
    return filtersHTML;
}

/**
 * Groups an array of data items by their ID column.
 * Uses the dynamically selected `ID_COLUMN_KEY`.
 * @param {Array<Object>} data - The array of data items (rows).
 * @returns {Object} An object where keys are IDs and values are arrays of items belonging to that ID.
 */
function groupDataById(data) {
    const grouped = {};
    if (!ID_COLUMN_KEY) {
        console.warn("ID_COLUMN_KEY is not defined. Cannot group data.");
        // Return an empty object or handle as needed if no ID column is set.
        // For display, we might want to group by a generic index if no ID is selected.
        return { "No ID Column Selected": data };
    }
    data.forEach(item => {
        const id = item[ID_COLUMN_KEY] ? String(item[ID_COLUMN_KEY]).trim() : 'No ' + ID_COLUMN_KEY;
        if (!grouped[id]) {
            grouped[id] = [];
        }
        grouped[id].push(item);
    });
    return grouped;
}

/**
 * Generates the HTML for the Summary view, which groups tickets by their ID.
 * This function no longer filters out "completed" or "closed" items by default.
 * Filtering is now solely controlled by user-selected checkboxes.
 * @returns {string} The HTML string for the Summary view.
 */
function generateSummaryViewHTML() {
    // Check if mainDataSheetName and workbookData[mainDataSheetName] exist, and also if ID_COLUMN_KEY is set.
    if (!mainDataSheetName || !workbookData[mainDataSheetName] || workbookData[mainDataSheetName].data.length === 0 || !ID_COLUMN_KEY) {
        return `<p>No data available in "${mainDataSheetName}" to summarize, or no Main ID Column selected.</p>`;
    }

    const data = workbookData[mainDataSheetName].data;

    // IMPORTANT: Removed default filtering by config.defaultExcludedStatusesForSummary here.
    // All data is passed to groupDataById, and filtering is handled by applyAllFilters based on checkboxes.
    const groupedData = groupDataById(data); // Group all data by ID

    let summaryItemsHTML = '<div class="summary-view-content">';
    
    // Sort the grouped IDs (numerically first, then alphabetically)
    const sortedIds = Object.keys(groupedData).sort((a, b) => {
        const numA = parseInt(a, 10);
        const numB = parseInt(b, 10);
        if (!isNaN(numA) && !isNaN(numB)) {
            return numA - numB;
        }
        return a.localeCompare(b);
    });

    // Iterate through sorted IDs to create summary cards
    sortedIds.forEach(id => {
        const itemsInGroup = groupedData[id];
        summaryItemsHTML += '<div class="summary-item" data-id-group="' + id + '">';
        summaryItemsHTML += `<h3 class="summary-group-header">${ID_COLUMN_KEY || 'ID'}: ${id}</h3>`; // Use mapped ID key or fallback

        itemsInGroup.forEach(item => {
            summaryItemsHTML += '<div class="summary-item-subitem">';

            /**
             * Helper to generate HTML for a single field within a summary sub-item.
             * @param {*} itemValue - The value of the field.
             * @param {string} fieldName - The header name of the field.
             * @param {string} label - The display label for the field.
             * @returns {string} HTML for the field.
             */
            function getFieldHtml(itemValue, fieldName, label) {
                let displayVal = formatForDisplay(itemValue, fieldName, 5); // Limit notes to 5 bullet points

                // Don't display ID column as it's already in the group header
                if (fieldName === ID_COLUMN_KEY) return '';
                // Use h4 for Activity Description as a sub-item title
                if (fieldName === ACTIVITY_DESCRIPTION_KEY) {
                       return item[ACTIVITY_DESCRIPTION_KEY] ? `<h4>${displayVal}</h4>` : '';
                }
                // Special handling for Notes/Action Items to allow bullet points
                if (fieldName === NOTES_COLUMN_KEY) {
                    return item[NOTES_COLUMN_KEY] ? `<p><strong data-field-label="${label}">${label}:</strong></p>${displayVal}` : '';
                }
                // General paragraph formatting for other fields, showing if value exists or if it's ETA/Status
                return (itemValue !== null && itemValue !== undefined && String(itemValue).trim() !== '') || (fieldName === ETA_COLUMN_KEY || fieldName === STATUS_COLUMN_KEY || fieldName === PRIORITY_COLUMN_KEY) ?
                            `<p><strong data-field-label="${label}">${label}:</strong> <span data-field="${fieldName}">${displayVal}</span></p>` : '';
            }
            
            // Dynamically display all relevant fields for each item based on identified headers
            columnHeaders.forEach(header => {
                if (header !== ID_COLUMN_KEY) { // Skip the ID column as it's in the group header
                    summaryItemsHTML += getFieldHtml(item[header], header, header);
                }
            });

            summaryItemsHTML += '</div>'; // Close summary-item-subitem
        });
        summaryItemsHTML += '</div>'; // Close summary-item (group card)
    });
    summaryItemsHTML += '</div>'; // Close summary-view-content
    return summaryItemsHTML;
}

/**
 * Activates a specific tab and updates its content.
 * @param {string} tabName - The name of the tab to show.
 */
function showTab(tabName) {
    currentActiveTabName = tabName; // Update active tab tracker
    
    // Deactivate all tab panes and buttons
    document.querySelectorAll('.tab-pane').forEach(pane => pane.classList.remove('active'));
    document.querySelectorAll('.tab-buttons button').forEach(btn => btn.classList.remove('active'));

    const paneId = `content-${tabName.replace(/\s+/g, '-')}`;
    const paneElement = document.getElementById(paneId);
    if (paneElement) {
        // Render content based on tab type
        if (tabName === 'Summary' && mainDataSheetName && workbookData[mainDataSheetName] && ID_COLUMN_KEY) {
            paneElement.innerHTML = generateSummaryFilterInputsHTML() + generateSummaryViewHTML();
        } else if (workbookData[tabName]) {
            paneElement.innerHTML = generateTableHTML(tabName);
        } else {
            paneElement.innerHTML = "<p>No data for this tab or tab type not recognized for dynamic content.</p>";
        }
        paneElement.classList.add('active'); // Activate the selected pane
    }

    // Activate the corresponding tab button
    const buttons = document.querySelectorAll('.tab-buttons button');
    for(let btn of buttons) {
        if(btn.textContent === tabName) {
            btn.classList.add('active');
            break;
        }
    }
    applyAllFilters(); // Re-apply filters whenever a tab is switched
}

/**
 * Applies all active filters (text and status checkboxes) to the currently
 * displayed tab (either Summary view or a data table).
 */
function applyAllFilters() {
    if (!currentActiveTabName) return; // Do nothing if no tab is active

    if (currentActiveTabName === 'Summary') {
        filterSummaryViewByFields();
    } else if (workbookData[currentActiveTabName]) {
        filterActiveTableByColumns();
    }
}

/**
 * Sorts the data within a specific sheet and re-renders its table.
 * @param {string} sheetName - The name of the sheet whose data needs sorting.
 * @param {string} header - The header of the column to sort by.
 */
function sortTable(sheetName, header) {
    // Summary view is grouped, not directly sortable by columns
    if (sheetName === 'Summary') return; 

    const sheetInfo = workbookData[sheetName];
    if (!sheetInfo || sheetInfo.data.length === 0) return;

    const sheetData = sheetInfo.data;
    const directionKey = `${sheetName}-${header}`;
    // Toggle sort direction (true for ascending, false for descending)
    sortDirections[directionKey] = !sortDirections[directionKey]; 

    sheetData.sort((a, b) => {
        const aValue = a[header];
        const bValue = b[header];

        // Handle null/undefined/empty string values by pushing them to the end
        if (aValue === null || aValue === undefined || String(aValue).trim() === '') {
            return sortDirections[directionKey] ? 1 : -1;
        }
        if (bValue === null || bValue === undefined || String(bValue).trim() === '') {
            return sortDirections[directionKey] ? -1 : 1;
        }

        // Attempt numeric comparison first (handles numbers and Excel serial dates)
        const numA = typeof aValue === 'number' ? aValue : parseFloat(aValue);
        const numB = typeof bValue === 'number' ? bValue : parseFloat(bValue);

        // If both are valid numbers, compare numerically
        if (!isNaN(numA) && !isNaN(numB) && (typeof aValue === 'number' || !isNaN(parseFloat(aValue))) && (typeof bValue === 'number' || !isNaN(parseFloat(bValue)))) { // Ensure values are truly numeric
            return sortDirections[directionKey] ? numA - numB : numB - numA;
        } else {
            // Otherwise, perform a case-insensitive string comparison
            const strA = String(aValue).toLowerCase();
            const strB = String(bValue).toLowerCase();
            if (strA < strB) return sortDirections[directionKey] ? -1 : 1;
            if (strA > strB) return 1;
        }
        return 0; // Values are equal
    });

    // Re-render the table with sorted data
    const paneElement = document.getElementById(`content-${sheetName.replace(/\s+/g, '-')}`);
    if (paneElement) {
        paneElement.innerHTML = generateTableHTML(sheetName);
        applyAllFilters(); // Re-apply column filters after sort
    }
}

/**
 * Filters the Summary view based on text inputs and status checkboxes.
 * Hides individual summary items and their parent groups if they don't match filters.
 */
function filterSummaryViewByFields() {
    const activePane = document.querySelector('#content-Summary.tab-pane.active');
    if (!activePane) return;

    // Get active text filters
    const filterInputs = activePane.querySelectorAll('.summary-filters-container input.summary-field-filter');
    const activeTextFilters = {};
    filterInputs.forEach(input => {
        const key = input.dataset.filterKey;
        const value = input.value.toUpperCase();
        if (value) {
            activeTextFilters[key] = value;
        }
    });

    // Get active status hide filters
    const hideStatusCheckboxes = document.querySelectorAll('#dynamicStatusCheckboxes input[type="checkbox"]:checked');
    const statusesToHide = Array.from(hideStatusCheckboxes).map(cb => cb.dataset.statusValue);

    const allSummaryItems = activePane.querySelectorAll('.summary-view-content .summary-item');

    allSummaryItems.forEach(groupCard => {
        let anySubItemVisibleInGroup = false; // Tracks if any sub-item within this group is visible

        const subItems = groupCard.querySelectorAll('.summary-item-subitem');
        
        subItems.forEach(subItemElement => {
            let showSubItem = true; // Assume visible initially
            
            // Collect field values from the sub-item's HTML for filtering
            const fieldValues = {};
            subItemElement.querySelectorAll('[data-field]').forEach(el => {
                fieldValues[el.dataset.field] = el.textContent.toUpperCase();
            });
            const h4Element = subItemElement.querySelector('h4');
            // Ensure ACTIVITY_DESCRIPTION_KEY is found before trying to get its content
            if (h4Element && ACTIVITY_DESCRIPTION_KEY) fieldValues[ACTIVITY_DESCRIPTION_KEY] = h4Element.textContent.toUpperCase();
            const ulElement = subItemElement.querySelector('ul');
            // Ensure NOTES_COLUMN_KEY is found before trying to get its content
            if (ulElement && NOTES_COLUMN_KEY) fieldValues[NOTES_COLUMN_KEY] = ulElement.textContent.toUpperCase().replace(/\s+/g, ' ');

            // Apply text filters: If any field doesn't match its filter, hide the sub-item
            for (const fieldKey in activeTextFilters) {
                const filterText = activeTextFilters[fieldKey];
                const fieldValue = fieldValues[fieldKey] || ''; // Get the value for the current field

                if (fieldValue.indexOf(filterText) === -1) {
                    showSubItem = false;
                    break; // No need to check other text filters if one fails
                }
            }

            // Apply status hide filters if the sub-item is still visible
            if (showSubItem && STATUS_COLUMN_KEY) {
                const currentStatus = (fieldValues[STATUS_COLUMN_KEY] || '').toLowerCase();
                // 'needs status!' will not match any status in the `statusesToHide` array, so it won't be hidden by this filter
                if (statusesToHide.includes(currentStatus.replace('needs status!',''))) { 
                    showSubItem = false;
                }
            }

            // Set display style for the sub-item
            subItemElement.style.display = showSubItem ? '' : 'none';
            if (showSubItem) {
                anySubItemVisibleInGroup = true; // Mark that at least one sub-item in this group is visible
            }
        });

        // Hide the entire group card if no sub-items within it are visible
        groupCard.style.display = anySubItemVisibleInGroup ? '' : 'none';
    });
}

/**
 * Filters the active data table based on column filter inputs and status checkboxes.
 */
function filterActiveTableByColumns() {
    const pane = document.querySelector('.tab-pane.active');
    // Do not filter if no pane active, or if it's the Summary tab, or if main data isn't loaded
    if (!pane || currentActiveTabName === 'Summary' || !mainDataSheetName || !workbookData[mainDataSheetName]) return;
    
    const table = pane.querySelector('table');
    if (!table) return;

    // Get active column text filters
    const filters = {};
    table.querySelectorAll('thead input.column-filter').forEach(i => { 
        if (i.value) filters[i.dataset.columnHeader] = i.value.toUpperCase(); 
    });
    
    // Get active status hide filters
    const hideStatusCheckboxes = document.querySelectorAll('#dynamicStatusCheckboxes input[type="checkbox"]:checked');
    const statusesToHide = Array.from(hideStatusCheckboxes).map(cb => cb.dataset.statusValue);

    const data = workbookData[currentActiveTabName].data || []; // Get the raw data for the current sheet

    table.querySelectorAll('tbody tr').forEach((row, index) => {
        let show = true; // Assume row is visible
        const dataItem = data[index]; // Get the corresponding data item for this row

        // Apply column text filters
        for(const key in filters) {
            let val = getComparableValue(dataItem[key], key); // Get comparable value for filtering
            if(!val.toUpperCase().includes(filters[key])) { 
                show = false; 
                break; // If one filter fails, hide the row
            }
        }

        // Apply status hide filters if the row is still visible and a status column is identified
        if(show && STATUS_COLUMN_KEY && dataItem.hasOwnProperty(STATUS_COLUMN_KEY)) {
            const currentStatus = (dataItem[STATUS_COLUMN_KEY] || '').toLowerCase();
             if (statusesToHide.includes(currentStatus)) {
                show = false;
            }
        }
        row.style.display = show ? '' : 'none'; // Set row display style
    });
}

/**
 * Generates the HTML for a single sub-item within the print view.
 * @param {Object} item - The data item (row) to generate HTML for.
 * @returns {string} The HTML string for the print sub-item.
 */
function generatePrintSubItemHtml(item) {
    let subItemHtml = '<div class="print-item-subitem">';

    /**
     * Helper to generate HTML for a single field within a print sub-item.
     * @param {*} itemValue - The value of the field.
     * @param {string} fieldName - The header name of the field.
     * @param {string} label - The display label for the field.
     * @returns {string} HTML for the field.
     */
    function getPrintFieldHtml(itemValue, fieldName, label) {
        let displayVal = formatForDisplay(itemValue, fieldName, 5); // Limit notes to 5 bullet points for print

        if (fieldName === ACTIVITY_DESCRIPTION_KEY) {
            return item[ACTIVITY_DESCRIPTION_KEY] ? `<h4>${displayVal}</h4>` : '';
        }
        if (fieldName === NOTES_COLUMN_KEY) {
            return item[NOTES_COLUMN_KEY] ? `<p><strong>${label}:</strong></p>${displayVal}` : '';
        }
        // Don't print the ID column in sub-item details as it's the group header
        if (fieldName === ID_COLUMN_KEY) return '';

        // Only include if value exists or if it's ETA/Status/Priority that get special 'needs attention' text
        return (itemValue !== null && itemValue !== undefined && String(itemValue).trim() !== '') || 
               (fieldName === ETA_COLUMN_KEY || fieldName === STATUS_COLUMN_KEY || fieldName === PRIORITY_COLUMN_KEY) ?
                    `<p><strong>${label}:</strong> ${displayVal}</p>` : '';
    }
    
    // Dynamically add all relevant fields from the item based on configured keys
    columnHeaders.forEach(header => {
        if (header !== ID_COLUMN_KEY) { // Skip ID as it's the group header
            subItemHtml += getPrintFieldHtml(item[header], header, header);
        }
    });

    subItemHtml += '</div>'; // Close print-item-subitem
    return subItemHtml;
}

/**
 * Toggles the disabled state of the print button based on whether
 * main data is loaded.
 */
function togglePrintButtonVisibility() {
    const printButton = document.getElementById('printPriorityButton');
    // Enable print button only if main data sheet has data AND a main ID column is selected
    if (mainDataSheetName && workbookData[mainDataSheetName] && workbookData[mainDataSheetName].data.length > 0 && ID_COLUMN_KEY) {
        printButton.disabled = false;
    } else {
        printButton.disabled = true;
    }
}


/**
 * Generates and triggers the print view of the tracker data.
 * Filters and groups data based on user selections (Plan filter, Group by Plan, etc.).
 */
function handlePrint() { // Renamed from handlePrintView
    console.log("handlePrint called."); // Debugging: Confirm function call

    if (!mainDataSheetName || !workbookData[mainDataSheetName] || workbookData[mainDataSheetName].data.length === 0 || !ID_COLUMN_KEY) {
        alert("No data available to print or no Main ID Column selected. Please load an Excel file with data and select a Main ID Column.");
        return;
    }

    const data = workbookData[mainDataSheetName].data;
    const planFilterText = document.getElementById('printPlanFilterInput').value.trim().toLowerCase();
    const assignedToFilterText = document.getElementById('printAssignedToFilterInput').value.trim().toLowerCase();
    const priorityFilterValue = document.getElementById('printPriorityFilterInput').value.trim().toLowerCase();
    const printSortByColumn = document.getElementById('printSortByInput').value;
    const groupByPlan = document.getElementById('printGroupByPlanCheckbox').checked;

    const printHideStatusCheckboxes = document.querySelectorAll('#dynamicPrintStatusCheckboxes input[type="checkbox"]:checked');
    const printStatusesToHide = Array.from(printHideStatusCheckboxes).map(cb => cb.dataset.statusValue);

    let initialFilteredData = data.filter(item => {
        const status = STATUS_COLUMN_KEY ? String(item[STATUS_COLUMN_KEY] || '').toLowerCase() : '';
        const plan = PLAN_COLUMN_KEY ? String(item[PLAN_COLUMN_KEY] || '').trim().toLowerCase() : '';
        const assignedTo = ASSIGNED_TO_COLUMN_KEY ? String(item[ASSIGNED_TO_COLUMN_KEY] || '').trim().toLowerCase() : '';
        const priority = PRIORITY_COLUMN_KEY ? String(item[PRIORITY_COLUMN_KEY] || '').trim().toLowerCase() : '';

        // Apply Plan filter
        const planMatch = !planFilterText || plan.includes(planFilterText);
        
        // Apply Assigned To filter
        const assignedToMatch = !assignedToFilterText || assignedTo.includes(assignedToFilterText);

        // Apply Priority filter
        const priorityMatch = !priorityFilterValue || 
                              (priorityFilterValue === 'needs priority!' && (priority === '' || priority === 'needs priority!')) ||
                              (priorityFilterValue !== 'needs priority!' && priority === priorityFilterValue);

        // Apply Status hide filters - only hide if checkbox is checked
        const isStatusHidden = printStatusesToHide.includes(status);

        // IMPORTANT: Removed default exclusion for config.defaultExcludedStatusesForSummary here.
        // Now, *only* statuses checked in the 'Hide Statuses' checkboxes will be hidden.
        return planMatch && assignedToMatch && priorityMatch && !isStatusHidden;
    });

    if (initialFilteredData.length === 0) {
        alert("No items found to print based on the current filter selections. Please adjust your filters.");
        return;
    }

    let printHtml = '<div id="print-area">';

    /**
     * Helper function to build a single print section (e.g., "Priority Tasks").
     * @param {string} title - The title of the print section.
     * @param {Function} dataFilterFn - A function to filter items specific to this section.
     * @param {Function} defaultSectionSortFn - The default sorting function for this section if no global sort is applied.
     * @returns {string} HTML for the print section.
     */
    const buildPrintSection = (title, dataFilterFn, defaultSectionSortFn) => {
        // Include current filter summaries in the section title
        let filterSummary = [];
        if (planFilterText && PLAN_COLUMN_KEY) filterSummary.push(`Plan: "${document.getElementById('printPlanFilterInput').value}"`);
        if (assignedToFilterText && ASSIGNED_TO_COLUMN_KEY) filterSummary.push(`Assigned To: "${document.getElementById('printAssignedToFilterInput').value}"`);
        if (priorityFilterValue && PRIORITY_COLUMN_KEY) filterSummary.push(`Priority: "${document.getElementById('printPriorityFilterInput').value}"`);
        if (printSortByColumn) filterSummary.push(`Sorted by: "${printSortByColumn}"`); // Add global sort to summary

        let sectionTitleSuffix = filterSummary.length > 0 ? ` (${filterSummary.join(', ')})` : '';

        let sectionHtml = `<div class="print-section"><h2>${title}${sectionTitleSuffix}</h2>`;
        
        // Filter items specifically for this section, starting from the already initially filtered data
        let sectionItems = initialFilteredData.filter(dataFilterFn);

        if (sectionItems.length === 0) {
            sectionHtml += `<p>No items found for this section.</p></div>`;
            return sectionHtml;
        }

        const groupedSectionItems = groupDataById(sectionItems);

        // Determine the primary sorting function for the SR # groups
        const primaryGroupSortFn = (idA, idB) => {
            const itemA = groupedSectionItems[idA][0]; // Take first item of group for sorting criteria
            const itemB = groupedSectionItems[idB][0];

            // 1. Apply global print sort column first, if selected
            if (printSortByColumn && columnHeaders.includes(printSortByColumn)) {
                const valA = itemA[printSortByColumn]; // Get raw value for comparison
                const valB = itemB[printSortByColumn];

                // Determine if it's a date column for oldest-first (ascending)
                const isDateColumn = [START_DATE_KEY, ETA_COLUMN_KEY, COMPLETION_DATE_KEY].includes(printSortByColumn);

                if (isDateColumn) {
                    // Convert Excel date serial numbers to a comparable number (milliseconds since epoch)
                    const dateValA = typeof valA === 'number' && valA > 20000 ? 
                        new Date(Math.round((valA - 25569) * 86400 * 1000)).getTime() : Infinity;
                    const dateValB = typeof valB === 'number' && valB > 20000 ? 
                        new Date(Math.round((valB - 25569) * 86400 * 1000)).getTime() : Infinity;
                    
                    // Handle null/undefined dates by pushing them to the end
                    if (dateValA === Infinity && dateValB === Infinity) return 0;
                    if (dateValA === Infinity) return 1;
                    if (dateValB === Infinity) return -1;

                    if (dateValA !== dateValB) return dateValA - dateValB; // Oldest first (ascending)
                } else {
                    // Attempt numeric sort for other columns
                    const numValA = parseFloat(valA);
                    const numValB = parseFloat(valB);
                    if (!isNaN(numValA) && !isNaN(numValB) && (typeof valA === 'number' || !isNaN(parseFloat(valA))) && (typeof valB === 'number' || !isNaN(parseFloat(valB)))) { // Ensure values are truly numeric
                        if (numValA !== numValB) return numValA - numValB; // Numeric ascending
                    } else {
                        // Fallback to string sort
                        const strA = String(valA || '').toLowerCase();
                        const strB = String(valB || '').toLowerCase();
                        if (strA < strB) return -1;
                        if (strA > strB) return 1;
                    }
                }
            }
            
            // 2. Fallback to section-specific sort if no global sort column selected or if global sort resulted in a tie
            const sectionSortResult = defaultSectionSortFn(itemA, itemB);
            if (sectionSortResult !== 0) return sectionSortResult;

            // 3. Final fallback: Sort by ID numerically, then alphabetically (for stable order)
            const numA = parseInt(idA, 10);
            const numB = parseInt(idB, 10);
            if (!isNaN(numA) && !isNaN(numB)) {
                return numA - numB;
            }
            return idA.localeCompare(idB);
        };

        // Group by Plan first if requested, otherwise directly sort by ID groups
        if (groupByPlan && PLAN_COLUMN_KEY) {
            const plans = [...new Set(sectionItems.map(item => String(item[PLAN_COLUMN_KEY] || 'Unspecified Plan')))].sort();
            
            plans.forEach(planName => {
                let itemsForPlan = sectionItems.filter(item => String(item[PLAN_COLUMN_KEY] || 'Unspecified Plan') === planName);
                if (itemsForPlan.length > 0) {
                    sectionHtml += `<h3 class="plan-subheader">Plan: ${planName}</h3>`;
                    const groupedItemsForPlan = groupDataById(itemsForPlan);
                    
                    // Sort IDs within each plan group using the determined primaryGroupSortFn
                    const sortedIdsForPlan = Object.keys(groupedItemsForPlan).sort(primaryGroupSortFn);

                    sortedIdsForPlan.forEach(id => {
                        sectionHtml += `<div class="print-item">`;
                        sectionHtml += `<h4 class="print-item-group-header">${ID_COLUMN_KEY || 'ID'}: ${id}</h4>`;
                        // Sort sub-items within each ID group by Activity Description
                        if (ACTIVITY_DESCRIPTION_KEY) {
                            groupedItemsForPlan[id].sort((a, b) => (a[ACTIVITY_DESCRIPTION_KEY] || '').localeCompare(b[ACTIVITY_DESCRIPTION_KEY] || ''));
                        }
                        groupedItemsForPlan[id].forEach(item => {
                            sectionHtml += generatePrintSubItemHtml(item);
                        });
                        sectionHtml += `</div>`;
                    });
                }
            });
        } else { // Not grouping by plan, just by ID (applying primaryGroupSortFn)
            const sortedIds = Object.keys(groupedSectionItems).sort(primaryGroupSortFn);

            sortedIds.forEach(id => {
                sectionHtml += `<div class="print-item">`;
                sectionHtml += `<h4 class="print-item-group-header">${ID_COLUMN_KEY || 'ID'}: ${id}</h4>`;
                // Sort sub-items within each ID group by Activity Description
                if (ACTIVITY_DESCRIPTION_KEY) {
                     groupedSectionItems[id].sort((a, b) => (a[ACTIVITY_DESCRIPTION_KEY] || '').localeCompare(b[ACTIVITY_DESCRIPTION_KEY] || ''));
                }
               
                groupedSectionItems[id].forEach(item => {
                    sectionHtml += generatePrintSubItemHtml(item);
                });
                sectionHtml += `</div>`;
            });
        }
        sectionHtml += '</div><div class="page-break"></div>'; // Add a page break after each section
        return sectionHtml;
    };

    // Defines the sorting function for "Priority Tasks" section (default when no global sort selected)
    const prioritySortFn = (a, b) => {
        if (!PRIORITY_COLUMN_KEY) return 0; // If no priority column, no special sorting

        // Map priority keywords to numeric values for comparison
        const priorityA = config.priorityLevels[String(a[PRIORITY_COLUMN_KEY] || '').trim().toLowerCase()] || 99; // Default to high number for unknown priority
        const priorityB = config.priorityLevels[String(b[PRIORITY_COLUMN_KEY] || '').trim().toLowerCase()] || 99;
        if (priorityA !== priorityB) return priorityA - priorityB;

        // Fallback to Start Date if priorities are equal
        const dateA = START_DATE_KEY && typeof a[START_DATE_KEY] === 'number' ? a[START_DATE_KEY] : Infinity;
        const dateB = START_DATE_KEY && typeof b[START_DATE_KEY] === 'number' ? b[START_DATE_KEY] : Infinity;
        return dateA - dateB;
    };

    // Defines the sorting function for date-based sections (default when no global sort selected)
    const dateSortFn = (a, b) => {
        if (!START_DATE_KEY) return 0; // If no start date column, no special sorting
        const dateA = typeof a[START_DATE_KEY] === 'number' ? a[START_DATE_KEY] : Infinity;
        const dateB = typeof b[START_DATE_KEY] === 'number' ? b[START_DATE_KEY] : Infinity;
        return dateA - dateB;
    };

    // Define the different print sections with their titles, filters, and default sort functions
    const printSections = [
        {
            title: 'Priority Tasks to be Completed Next',
            filter: item => true, // No default filtering here, all filtering happens in initialFilteredData
            sort: prioritySortFn
        },
        {
            title: 'Pending Internal Validation',
            filter: item => STATUS_COLUMN_KEY && (item[STATUS_COLUMN_KEY] || '').toLowerCase() === 'pending internal validation',
            sort: dateSortFn
        },
        {
            title: 'Pending Client Validation',
            filter: item => STATUS_COLUMN_KEY && (item[STATUS_COLUMN_KEY] || '').toLowerCase() === 'pending client validation',
            sort: dateSortFn
        }
    ];

    // Build print HTML for each defined section
    printSections.forEach(section => {
        printHtml += buildPrintSection(section.title, section.filter, section.sort);
    });
    
    printHtml += '</div>'; // Close print-area

    // Create an invisible iframe to handle printing
    const iframe = document.createElement('iframe');
    iframe.style.height = '0';
    iframe.style.width = '0';
    iframe.style.position = 'absolute';
    iframe.style.visibility = 'hidden';
    document.body.appendChild(iframe);

    // Use onload event to ensure content is fully loaded before printing
    iframe.onload = function() {
        console.log("Iframe loaded, attempting to print."); // Debugging: Confirm iframe load
        try {
            iframe.contentWindow.focus();
            iframe.contentWindow.print();
        } catch (printError) {
            console.error("Error during iframe print:", printError);
            alert("Could not trigger print. Please check your browser's print settings or try again.");
        } finally {
            // Remove the iframe after a short delay, regardless of print success
            setTimeout(() => {
                console.log("Removing iframe."); // Debugging: Confirm iframe removal
                document.body.removeChild(iframe);
            }, 1000);
        }
    };

    const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
    iframeDoc.open();
    iframeDoc.write('<html><head><title>Print View</title>');
    
    // Copy all styles from the main document to the iframe
    // This part is crucial for styling the print output.
    let printStyles = '';
    Array.from(document.styleSheets).forEach(styleSheet => {
        try {
            // Check if stylesheet is from the same origin to avoid security errors
            if (styleSheet.href === null || styleSheet.href.startsWith(window.location.origin)) {
                 printStyles += Array.from(styleSheet.cssRules)
                                    .map(rule => rule.cssText)
                                    .join('');
            } else {
                console.warn(`Skipping cross-origin stylesheet: ${styleSheet.href}`);
            }
        } catch (e) {
            console.warn("Could not access CSS rules for stylesheet:", styleSheet.href, e);
        }
    });

    iframeDoc.write('<style>' + printStyles + '</style>');
    iframeDoc.write('</head><body>');
    iframeDoc.write(printHtml);
    iframeDoc.write('</body></html>');
    iframeDoc.close(); // Important: Closes the document stream, which triggers rendering.

    console.log("Iframe content written. Waiting for iframe onload."); // Debugging: Confirm content write
}
