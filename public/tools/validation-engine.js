// public/tools/validation-engine.js

// --- Global Variables to store parsed data and rules ---
let parsedExcelData = null; // Stores the parsed data from the main Excel file
let parsedDataDictionaryRules = null; // Stores parsed rules from the selected data dictionary (e.g., from rules_json)
let validationRules = {}; // Stores validation rules extracted from the data dictionary in a usable format
let analysisResults = {}; // Stores the results of the analysis for each sheet

// Store the selected main file (from server or local)
let selectedMainFileBlob = null;
let selectedMainFileName = null;


// --- Helper Functions ---

/**
 * Displays the loading spinner and disables relevant buttons.
 */
function showLoader() {
    document.getElementById('loader').style.display = 'block';
    document.getElementById('results').classList.add('hidden');
    document.getElementById('summaryReportContainer').style.display = 'none';
    document.getElementById('analyzeFileBtn').disabled = true;
    document.getElementById('loadMainFileBtn').disabled = true;
    document.getElementById('loadDataDictionaryBtn').disabled = true;
}

/**
 * Hides the loading spinner and enables relevant buttons.
 */
function hideLoader() {
    document.getElementById('loader').style.display = 'none';
    document.getElementById('analyzeFileBtn').disabled = false;
    document.getElementById('loadMainFileBtn').disabled = false;
    document.getElementById('loadDataDictionaryBtn').disabled = false;
}

/**
 * Displays a message on the UI.
 * @param {string} elementId - The ID of the HTML element to display the message in.
 * @param {string} message - The message text.
 * @param {'info' | 'success' | 'error'} type - The type of message (influences styling).
 */
function displayMessage(elementId, message, type = 'info') {
    const element = document.getElementById(elementId);
    if (element) {
        element.textContent = message;
        element.classList.remove('hidden', 'text-red-600', 'text-green-600', 'text-gray-600');
        if (type === 'error') {
            element.classList.add('text-red-600');
        } else if (type === 'success') {
            element.classList.add('text-green-600');
        } else {
            element.classList.add('text-gray-600');
        }
        element.classList.remove('hidden');
    }
}

// --- Authentication and Navigation (reused from other tools) ---

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
        console.log('User data:', data);
        return data;
    } catch (error) {
        console.error('Error verifying token:', error);
        localStorage.removeItem('jwtToken');
        window.location.href = '/';
        return null;
    }
}

function setupNavigation(userData) {
    const profileLink = document.getElementById('profileLink');
    if (profileLink && userData) {
        profileLink.textContent = `Hello, ${userData.username}`;
        profileLink.href = '#';
    }

    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', (e) => {
            e.preventDefault();
            localStorage.removeItem('jwtToken');
            window.location.href = '/';
        });
    }
}

// --- File and Data Dictionary Selection and Loading ---

/**
 * Populates the main file select dropdown (from company_files) and
 * the data dictionary select dropdown (from data_dictionaries).
 */
async function populateSelects() {
    const token = localStorage.getItem('jwtToken');
    if (!token) return;

    try {
        // --- Get general files (for main file selection) from list-files API ---
        const filesResponse = await fetch('/api/list-files', {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!filesResponse.ok) {
            console.error('Failed to fetch general files:', filesResponse.statusText);
            displayMessage('mainFileStatus', 'Could not load uploaded files list.', 'error');
            // Don't throw, as data dictionaries might still load
        }
        const filesResult = await filesResponse.json();
        const generalFiles = filesResult.files || [];


        // --- Get Data Dictionaries from NEW API ---
        const dictsResponse = await fetch('/api/list-data-dictionaries', {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!dictsResponse.ok) {
            throw new Error(`Failed to fetch data dictionaries: ${dictsResponse.statusText}`);
        }
        const dictsResult = await dictsResponse.json();
        const dataDictionaries = dictsResult.dictionaries || []; // Access the 'dictionaries' key


        const mainFileSelect = document.getElementById('mainFileSelect');
        const dataDictionarySelect = document.getElementById('dataDictionarySelect');

        // Clear existing options
        mainFileSelect.innerHTML = '<option value="">-- Select an Uploaded File --</option>';
        dataDictionarySelect.innerHTML = '<option value="">-- No Data Dictionary Selected --</option>';

        let hasMainFiles = false;
        let hasDataDictionaries = false;

        // Populate main file select (from generalFiles)
        generalFiles.forEach(file => {
            const optionMain = document.createElement('option');
            optionMain.value = file.id;
            optionMain.textContent = file.filename; // Uses 'filename' as returned by list-files.js
            mainFileSelect.appendChild(optionMain);
            hasMainFiles = true;
        });

        // Populate data dictionary select (from dataDictionaries)
        dataDictionaries.forEach(dict => {
            const optionDict = document.createElement('option');
            optionDict.value = dict.id;
            optionDict.textContent = dict.name; // Uses 'name' as returned by list-data-dictionaries.js
            dataDictionarySelect.appendChild(optionDict);
            hasDataDictionaries = true;
        });

        // Enable/disable selects and buttons based on fetched files
        if (!hasMainFiles) {
            mainFileSelect.innerHTML = '<option value="">No files uploaded yet.</option>';
            mainFileSelect.disabled = true;
            document.getElementById('loadMainFileBtn').disabled = true;
        } else {
            mainFileSelect.disabled = false;
            document.getElementById('loadMainFileBtn').disabled = false;
        }

        if (!hasDataDictionaries) {
            dataDictionarySelect.innerHTML = '<option value="">No data dictionaries uploaded.</option>';
            dataDictionarySelect.disabled = true;
            document.getElementById('loadDataDictionaryBtn').disabled = true;
        } else {
            dataDictionarySelect.disabled = false;
            document.getElementById('loadDataDictionaryBtn').disabled = false;
        }

    } catch (error) {
        console.error('Error populating file/dictionary selects:', error);
        displayMessage('dataDictionaryStatus', 'Error loading lists. Please try again.', 'error');
    }
}

/**
 * Loads the selected main Excel/CSV file from the server for analysis.
 */
async function loadMainFile() {
    const selectedFileId = document.getElementById('mainFileSelect').value;
    if (!selectedFileId) {
        displayMessage('mainFileStatus', 'Please select a file to load from the uploaded list.', 'error');
        selectedMainFileBlob = null;
        selectedMainFileName = null;
        return;
    }

    displayMessage('mainFileStatus', 'Loading selected file...', 'info');
    const token = localStorage.getItem('jwtToken');

    try {
        // This uses the old get-file API for general files (from company_files)
        const response = await fetch(`/api/get-file?id=${selectedFileId}`, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const fileDataJson = await response.json();
        // fileDataJson.fileData is base64 encoded from get-file.js
        const decodedFileData = atob(fileDataJson.fileData);
        const byteCharacters = decodedFileData.split('').map(char => char.charCodeAt(0));
        const byteArray = new Uint8Array(byteCharacters);

        selectedMainFileBlob = new Blob([byteArray], { type: fileDataJson.mimetype }); // Create Blob
        selectedMainFileName = fileDataJson.filename; // Get original filename
        
        displayMessage('mainFileStatus', `File loaded: ${selectedMainFileName}`, 'success');

        // Clear the local file input if a server file is loaded
        document.getElementById('excelFile').value = '';

    } catch (error) {
        console.error('Error fetching main file:', error);
        displayMessage('mainFileStatus', 'Failed to load file. Please try again.', 'error');
        selectedMainFileBlob = null;
        selectedMainFileName = null;
    }
}

/**
 * Loads the selected data dictionary's rules from the new API.
 */
async function loadDataDictionary() {
    const selectedDictId = document.getElementById('dataDictionarySelect').value;
    if (!selectedDictId) {
        displayMessage('dataDictionaryStatus', 'Please select a data dictionary.', 'error');
        parsedDataDictionaryRules = null;
        validationRules = {};
        return;
    }

    displayMessage('dataDictionaryStatus', 'Loading data dictionary...', 'info');
    const token = localStorage.getItem('jwtToken');

    try {
        // Use the NEW get-data-dictionary API
        const response = await fetch(`/api/get-data-dictionary?id=${selectedDictId}`, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const dictionaryContent = await response.json();
        // rules_json is now directly a JSON object from the new API, no base64 decoding needed!
        const rulesData = dictionaryContent.rules_json;

        if (rulesData && Array.isArray(rulesData)) {
            parsedDataDictionaryRules = rulesData; // Store the raw rules array
            extractValidationRules(parsedDataDictionaryRules); // Process rules
            displayMessage('dataDictionaryStatus', `Data dictionary loaded: ${document.getElementById('dataDictionarySelect').options[document.getElementById('dataDictionarySelect').selectedIndex].text}`, 'success');
        } else {
            displayMessage('dataDictionaryStatus', 'Data dictionary content is invalid or empty.', 'error');
            parsedDataDictionaryRules = null;
            validationRules = {};
        }

    } catch (error) {
        console.error('Error fetching data dictionary:', error);
        displayMessage('dataDictionaryStatus', 'Failed to load data dictionary. Please try again.', 'error');
        parsedDataDictionaryRules = null;
        validationRules = {};
    }
}

/**
 * Transforms the raw data dictionary rules into a usable `validationRules` object
 * keyed by column name.
 * @param {Array<object>} dataDictionaryRules - Array of rule objects from the dictionary.
 */
function extractValidationRules(dataDictionaryRules) {
    validationRules = {}; // Reset rules
    if (!dataDictionaryRules || dataDictionaryRules.length === 0) {
        console.warn("Data dictionary has no rules defined.");
        return;
    }

    dataDictionaryRules.forEach(rule => {
        const columnName = rule['Column Name'] ? String(rule['Column Name']).trim() : null;
        if (columnName) {
            if (!validationRules[columnName]) {
                validationRules[columnName] = [];
            }
            validationRules[columnName].push(rule);
        }
    });
    console.log("Extracted Validation Rules:", validationRules);
}

// --- Main File Analysis Logic ---

async function analyzeFile() {
    const localExcelFile = document.getElementById('excelFile').files[0];

    let fileToAnalyze = null;
    let fileName = null;

    if (localExcelFile) {
        fileToAnalyze = localExcelFile;
        fileName = localExcelFile.name;
        selectedMainFileBlob = null; // Clear server-loaded file if a local one is chosen
        document.getElementById('mainFileSelect').value = ''; // Clear server select
        displayMessage('mainFileStatus', '', 'info'); // Clear any previous server file status
    } else if (selectedMainFileBlob) {
        fileToAnalyze = selectedMainFileBlob;
        fileName = selectedMainFileName;
        document.getElementById('excelFile').value = ''; // Clear local file input if a server file is chosen
    } else {
        alert('Please select an Excel or CSV file to validate, either from your local machine or from your uploaded files.');
        return;
    }

    if (!fileToAnalyze) {
        alert('No file available for analysis.');
        return;
    }

    showLoader();
    analysisResults = {}; // Reset results

    document.getElementById('fileName').textContent = `Analyzing: ${fileName}`;

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });

            parsedExcelData = workbook; // Store the parsed workbook for later use

            let totalBlankCells = 0;
            let totalNullCount = 0;
            let totalFutureDates = 0;
            let totalDuplicateRows = 0;

            const sheetResultsContainer = document.getElementById('sheetResults');
            sheetResultsContainer.innerHTML = ''; // Clear previous sheet results

            workbook.SheetNames.forEach(sheetName => {
                const worksheet = workbook.Sheets[sheetName];
                const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 }); // Read as array of arrays

                if (jsonData.length === 0) return; // Skip empty sheets

                const sheetHeader = jsonData[0]; // First row is header
                const sheetData = jsonData.slice(1); // Remaining rows are data

                const currentSheetIssues = {
                    blankCells: {},
                    nullStrings: {},
                    futureDates: {},
                    duplicateRows: [], // Stores row numbers of duplicates
                    customValidation: {} // Stores custom rule violations per column
                };

                // --- Standard Validations (Blank, NULL, Future Dates) ---
                sheetData.forEach((row, rowIndex) => {
                    sheetHeader.forEach((header, colIndex) => {
                        const cellValue = row[colIndex];

                        // Blank Cells
                        if (cellValue === undefined || cellValue === null || String(cellValue).trim() === '') {
                            currentSheetIssues.blankCells[header] = (currentSheetIssues.blankCells[header] || 0) + 1;
                            totalBlankCells++;
                        }

                        // "NULL" Strings (case-insensitive)
                        if (typeof cellValue === 'string' && String(cellValue).trim().toLowerCase() === 'null') {
                            currentSheetIssues.nullStrings[header] = (currentSheetIssues.nullStrings[header] || 0) + 1;
                            totalNullCount++;
                        }

                        // Future Dates
                        if (typeof cellValue === 'number' && !isNaN(cellValue)) { // XLSX stores dates as numbers (OLE Automation date)
                            const jsDate = new Date(Math.round((cellValue - 25569) * 86400 * 1000));
                            if (jsDate instanceof Date && !isNaN(jsDate) && jsDate > new Date()) {
                                currentSheetIssues.futureDates[header] = (currentSheetIssues.futureDates[header] || 0) + 1;
                                totalFutureDates++;
                            }
                        } else if (typeof cellValue === 'string') {
                            try {
                                const parsedDate = new Date(cellValue);
                                if (parsedDate instanceof Date && !isNaN(parsedDate) && parsedDate > new Date()) {
                                    currentSheetIssues.futureDates[header] = (currentSheetIssues.futureDates[header] || 0) + 1;
                                    totalFutureDates++;
                                }
                            } catch (e) { /* ignore invalid date strings */ }
                        }
                    });
                });

                // --- Duplicate Rows ---
                const rowHashes = new Set();
                const duplicateRows = [];
                sheetData.forEach((row, index) => {
                    const rowString = JSON.stringify(row);
                    if (rowHashes.has(rowString)) {
                        duplicateRows.push(index + 2); // Excel row number (header + 1-indexed data)
                        totalDuplicateRows++;
                    } else {
                        rowHashes.add(rowString);
                    }
                });
                currentSheetIssues.duplicateRows = duplicateRows;


                // --- Custom Validation from Data Dictionary ---
                if (parsedDataDictionaryRules && Object.keys(validationRules).length > 0) {
                    sheetHeader.forEach((header, colIndex) => {
                        const columnName = String(header).trim();
                        if (validationRules[columnName]) { // Check if there are rules defined for this column
                            currentSheetIssues.customValidation[columnName] = [];
                            // Store unique values for 'UNIQUE' rule check
                            const uniqueColumnValues = new Set();
                            const uniqueDuplicates = []; // To store {row, value, message} for UNIQUE violations

                            validationRules[columnName].forEach(rule => {
                                const ruleType = String(rule['Validation Type']).trim().toUpperCase();
                                const ruleValue = rule['Validation Value'];
                                const failureMessage = rule['Failure Message'] || `Validation failed for ${columnName} (Rule: ${ruleType})`;

                                // For UNIQUE, we need to collect all column values first
                                if (ruleType === 'UNIQUE') {
                                    return; // Skip individual cell processing for UNIQUE here, handled later
                                }

                                sheetData.forEach((row, rowIndex) => {
                                    const cellValue = row[colIndex];
                                    let isValid = true;
                                    let issueDetails = {
                                        row: rowIndex + 2, // Excel row number (1-based + 1 for header)
                                        value: cellValue,
                                        message: failureMessage,
                                        ruleType: ruleType
                                    };

                                    switch (ruleType) {
                                        case 'REQUIRED':
                                            isValid = !(cellValue === undefined || cellValue === null || String(cellValue).trim() === '');
                                            break;
                                        case 'ALLOWED_VALUES':
                                            if (ruleValue) {
                                                const allowed = String(ruleValue).split(',').map(s => s.trim().toLowerCase());
                                                isValid = allowed.includes(String(cellValue || '').trim().toLowerCase()); // Handle undefined/null cellValue
                                            }
                                            break;
                                        case 'NUMERIC_RANGE':
                                            if (ruleValue) {
                                                const [min, max] = String(ruleValue).split('-').map(Number);
                                                const numericValue = parseFloat(cellValue);
                                                isValid = !isNaN(numericValue) && numericValue >= min && numericValue <= max;
                                            } else { isValid = false; } // Rule value missing
                                            break;
                                        case 'REGEX':
                                            if (ruleValue) {
                                                try {
                                                    const regex = new RegExp(ruleValue);
                                                    isValid = regex.test(String(cellValue || '')); // Handle undefined/null cellValue
                                                } catch (e) {
                                                    console.warn(`Invalid regex for column ${columnName}: ${ruleValue}. Skipping rule.`);
                                                    isValid = true; // Don't fail if regex is malformed
                                                }
                                            } else { isValid = false; } // Rule value missing
                                            break;
                                        case 'DATE_PAST':
                                            try {
                                                const dateValue = new Date(cellValue);
                                                // Check for valid date and if it's in the past
                                                isValid = dateValue instanceof Date && !isNaN(dateValue) && dateValue < new Date();
                                            } catch (e) {
                                                isValid = false; // Treat invalid date strings as failure
                                            }
                                            break;
                                        default:
                                            console.warn(`Unknown validation type: ${ruleType} for column ${columnName}. Skipping.`);
                                            isValid = true; // Assume valid for unknown rules
                                    }

                                    if (!isValid) {
                                        currentSheetIssues.customValidation[columnName].push(issueDetails);
                                    }
                                });
                            });

                            // Handle UNIQUE rule separately after all column values are collected
                            if (validationRules[columnName].some(r => String(r['Validation Type']).trim().toUpperCase() === 'UNIQUE')) {
                                const columnValues = sheetData.map(row => row[colIndex]);
                                const seenValues = new Set();
                                columnValues.forEach((val, idx) => {
                                    if (val !== undefined && val !== null && String(val).trim() !== '') {
                                        const lowerCaseVal = String(val).trim().toLowerCase();
                                        if (seenValues.has(lowerCaseVal)) {
                                            // Only add if not already marked as duplicate for this specific rule in this column
                                            const alreadyFlagged = uniqueDuplicates.some(issue =>
                                                issue.row === idx + 2 && issue.ruleType === 'UNIQUE'
                                            );
                                            if (!alreadyFlagged) {
                                                uniqueDuplicates.push({
                                                    row: idx + 2, // Excel row number
                                                    value: val,
                                                    message: `Value '${val}' in column '${columnName}' is not unique.`,
                                                    ruleType: 'UNIQUE'
                                                });
                                            }
                                        } else {
                                            seenValues.add(lowerCaseVal);
                                        }
                                    }
                                });
                                // Add collected UNIQUE violations to customValidation for this column
                                if (uniqueDuplicates.length > 0) {
                                    currentSheetIssues.customValidation[columnName] = currentSheetIssues.customValidation[columnName].concat(uniqueDuplicates);
                                }
                            }
                        }
                    });
                }

                analysisResults[sheetName] = currentSheetIssues;
                displaySheetResults(sheetName, currentSheetIssues, sheetHeader);
            });

            document.getElementById('totalBlankCellsDisplay').textContent = `Total Blank Cells: ${totalBlankCells}`;
            document.getElementById('totalNullCountDisplay').textContent = `Total "NULL" String Cells: ${totalNullCount}`;
            document.getElementById('totalFutureDatesDisplay').textContent = `Total Future Dates: ${totalFutureDates}`;
            document.getElementById('totalDuplicateRowsDisplay').textContent = `Total Duplicate Rows: ${totalDuplicateRows}`;

            document.getElementById('results').classList.remove('hidden');
            document.getElementById('generateSummaryBtn').classList.remove('hidden');

        } catch (error) {
            console.error('Error processing file:', error);
            alert('Error processing file. Please ensure it is a valid Excel or CSV file.');
            document.getElementById('results').classList.add('hidden');
            document.getElementById('generateSummaryBtn').classList.add('hidden');
        } finally {
            hideLoader();
        }
    };
    reader.readAsArrayBuffer(fileToAnalyze);
}


function displaySheetResults(sheetName, issues, header) {
    const sheetResultsContainer = document.getElementById('sheetResults');
    const sheetDiv = document.createElement('div');
    sheetDiv.classList.add('sheet-summary', 'mt-6');
    sheetDiv.innerHTML = `<h3 class="text-xl font-bold text-gray-800 mb-3">Sheet: ${sheetName}</h3>`;

    const issueCounts = {
        blankCells: Object.values(issues.blankCells).reduce((sum, count) => sum + count, 0),
        nullStrings: Object.values(issues.nullStrings).reduce((sum, count) => sum + count, 0),
        futureDates: Object.values(issues.futureDates).reduce((sum, count) => sum + count, 0),
        duplicateRows: issues.duplicateRows.length,
        customValidation: Object.values(issues.customValidation).flat().length
    };

    const overallSheetStatus = (issueCounts.blankCells === 0 && issueCounts.nullStrings === 0 &&
                                issueCounts.futureDates === 0 && issueCounts.duplicateRows === 0 &&
                                issueCounts.customValidation === 0) ? 'status-pass' : 'status-fail';

    const summaryList = document.createElement('ul');
    summaryList.innerHTML = `
        <li><strong>Blank Cells Found:</strong> <span class="${issueCounts.blankCells > 0 ? 'issue-count-error' : 'issue-count-ok'}">${issueCounts.blankCells}</span></li>
        <li><strong>"NULL" Strings Found:</strong> <span class="${issueCounts.nullStrings > 0 ? 'issue-count-error' : 'issue-count-ok'}">${issueCounts.nullStrings}</span></li>
        <li><strong>Future Dates Found:</strong> <span class="${issueCounts.futureDates > 0 ? 'issue-count-error' : 'issue-count-ok'}">${issueCounts.futureDates}</span></li>
        <li><strong>Duplicate Rows Found:</strong> <span class="${issueCounts.duplicateRows > 0 ? 'issue-count-error' : 'issue-count-ok'}">${issueCounts.duplicateRows.length}</span></li>
        <li><strong>Custom Validation Issues Found:</strong> <span class="${issueCounts.customValidation > 0 ? 'issue-count-error' : 'issue-count-ok'}">${issueCounts.customValidation}</span></li>
        <li><strong>Overall Sheet Status:</strong> <span class="${overallSheetStatus}">${overallSheetStatus === 'status-pass' ? 'PASS' : 'FAIL'}</span></li>
    `;
    sheetDiv.appendChild(summaryList);

    // Detailed issues table for each column with override checkboxes
    const detailedTable = document.createElement('table');
    detailedTable.classList.add('results-table', 'mt-4');
    let tableHtml = `<thead><tr><th>Column Name</th><th>Blank</th><th>NULL</th><th>Future Date</th><th>Custom Issues</th><th>Override</th></tr></thead><tbody>`;

    header.forEach(colName => {
        const cleanedColName = String(colName).trim();
        const blankCount = issues.blankCells[cleanedColName] || 0;
        const nullCount = issues.nullStrings[cleanedColName] || 0;
        const futureDateCount = issues.futureDates[cleanedColName] || 0;
        const customIssueCount = (issues.customValidation[cleanedColName] || []).length;

        tableHtml += `
            <tr>
                <td>${cleanedColName}</td>
                <td class="${blankCount > 0 ? 'issue-count-error' : 'issue-count-ok'}">${blankCount}</td>
                <td class="${nullCount > 0 ? 'issue-count-error' : 'issue-count-ok'}">${nullCount}</td>
                <td class="${futureDateCount > 0 ? 'issue-count-error' : 'issue-count-ok'}">${futureDateCount}</td>
                <td class="${customIssueCount > 0 ? 'issue-count-error' : 'issue-count-ok'}">${customIssueCount}</td>
                <td><input type="checkbox" data-sheet="${sheetName}" data-column="${cleanedColName}" class="override-checkbox"></td>
            </tr>
        `;
    });
    tableHtml += `</tbody>`;
    detailedTable.innerHTML = tableHtml;
    sheetDiv.appendChild(detailedTable);

    sheetResultsContainer.appendChild(sheetDiv);
}

// --- Summary Report Generation ---

function generateSummaryReport() {
    const summaryContainer = document.getElementById('summaryReportContainer');
    summaryContainer.innerHTML = '';
    summaryContainer.style.display = 'block';

    const excelFileName = selectedMainFileName || (document.getElementById('excelFile').files[0]?.name || "N/A");

    let reportHtml = `
        <h2 class="summary-report-title">Data Validation Summary Report</h2>
        <p class="summary-report-subtitle">For File: ${excelFileName}</p>
        <p class="summary-report-subtitle">Generated On: ${new Date().toLocaleString()}</p>
    `;

    let totalIssuesIdentified = 0;
    let totalIssuesOverridden = 0;
    let totalIssuesAfterOverride = 0;

    const overrideCheckboxes = document.querySelectorAll('.override-checkbox');
    const overriddenColumns = {};
    overrideCheckboxes.forEach(checkbox => {
        if (checkbox.checked) {
            const sheet = checkbox.dataset.sheet;
            const column = checkbox.dataset.column;
            if (!overriddenColumns[sheet]) {
                overriddenColumns[sheet] = {};
            }
            overriddenColumns[sheet][column] = true;
        }
    });

    for (const sheetName in analysisResults) {
        const sheetIssues = analysisResults[sheetName];
        const sheetHeader = parsedExcelData.Sheets[sheetName] ? XLSX.utils.sheet_to_json(parsedExcelData.Sheets[sheetName], { header: 1 })[0] : [];

        reportHtml += `<h3 class="text-xl font-bold text-gray-800 mt-8 mb-4">Sheet: ${sheetName}</h3>`;
        reportHtml += `<table class="summary-table">
            <thead>
                <tr>
                    <th class="column-header">Column Name</th>
                    <th>Blank Cells</th>
                    <th>"NULL" Strings</th>
                    <th>Future Dates</th>
                    <th>Custom Validation Issues</th>
                    <th>Total Issues (Column)</th>
                    <th>Status (After Override)</th>
                </tr>
            </thead>
            <tbody>`;

        let sheetTotalIssuesIdentified = 0;
        let sheetTotalIssuesOverridden = 0;
        let sheetTotalIssuesAfterOverride = 0;

        sheetHeader.forEach(colName => {
            const cleanedColName = String(colName).trim();
            const isOverridden = overriddenColumns[sheetName] && overriddenColumns[sheetName][cleanedColName];

            const blankCount = issues.blankCells[cleanedColName] || 0;
            const nullCount = issues.nullStrings[cleanedColName] || 0;
            const futureDateCount = issues.futureDates[cleanedColName] || 0;
            const customIssueCount = (issues.customValidation[cleanedColName] || []).length;

            const columnIssuesIdentified = blankCount + nullCount + futureDateCount + customIssueCount;
            sheetTotalIssuesIdentified += columnIssuesIdentified;

            let columnIssuesAfterOverride = columnIssuesIdentified;
            let statusClass = 'status-pass';
            let statusText = 'PASS';

            if (isOverridden) {
                columnIssuesAfterOverride = 0;
                sheetTotalIssuesOverridden += columnIssuesIdentified;
                statusClass = 'status-ignored';
                statusText = 'OVERRIDDEN';
            } else if (columnIssuesIdentified > 0) {
                statusClass = 'status-fail';
                statusText = 'FAIL';
            }
            sheetTotalIssuesAfterOverride += columnIssuesAfterOverride;


            reportHtml += `
                <tr>
                    <td>${cleanedColName}</td>
                    <td class="issue-count">${blankCount}</td>
                    <td class="issue-count">${nullCount}</td>
                    <td class="issue-count">${futureDateCount}</td>
                    <td class="issue-count">${customIssueCount}</td>
                    <td class="issue-count">${columnIssuesIdentified}</td>
                    <td class="${statusClass}">${statusText}</td>
                </tr>
            `;
        });
        reportHtml += `</tbody></table>`;

        const sheetOverallStatus = sheetTotalIssuesAfterOverride === 0 ? 'status-pass' : 'status-fail';
        reportHtml += `
            <div class="overall-summary mt-4">
                <p><strong>Total Issues Identified for Sheet (${sheetName}):</strong> ${sheetTotalIssuesIdentified}</p>
                <p><strong>Total Issues Overridden for Sheet (${sheetName}):</strong> ${sheetTotalIssuesOverridden}</p>
                <p><strong>Total Issues Remaining for Sheet (${sheetName}):</strong> <span class="${sheetOverallStatus}">${sheetTotalIssuesAfterOverride}</span></p>
                <p><strong>Sheet Overall Status (After Override):</strong> <span class="${sheetOverallStatus}">${sheetTotalIssuesAfterOverride === 0 ? 'PASS' : 'FAIL'}</span></p>
            </div>
        `;

        totalIssuesIdentified += sheetTotalIssuesIdentified;
        totalIssuesOverridden += sheetTotalIssuesOverridden;
        totalIssuesAfterOverride += sheetTotalIssuesAfterOverride;
    }

    reportHtml += `
        <h3 class="text-xl font-bold text-gray-800 mt-8 mb-4">Overall File Summary</h3>
        <div class="overall-summary">
            <p><strong>Grand Total Issues Identified:</strong> ${totalIssuesIdentified}</p>
            <p><strong>Grand Total Issues Overridden:</strong> ${totalIssuesOverridden}</p>
            <p><strong>Grand Total Issues Remaining (After Override):</strong> <span class="${totalIssuesAfterOverride === 0 ? 'status-pass' : 'status-fail'}">${totalIssuesAfterOverride}</span></p>
            <p><strong>Overall File Status (After Override):</strong> <span class="${totalIssuesAfterOverride === 0 ? 'status-pass' : 'status-fail'}">${totalIssuesAfterOverride === 0 ? 'PASS' : 'FAIL'}</span></p>
        </div>
        <div class="print-buttons print-hidden">
            <button class="print-button" onclick="window.print()">Print Report</button>
            <button class="export-button" onclick="exportReportToExcel()">Export Report + Data to Excel</button>
        </div>
    `;

    summaryContainer.innerHTML = reportHtml;
}

// --- Export Functionality ---

function exportReportToExcel() {
    if (!parsedExcelData) {
        alert("No Excel file has been analyzed yet to export.");
        return;
    }

    const newWorkbook = XLSX.utils.book_new();

    // Add original data sheets to the new workbook
    parsedExcelData.SheetNames.forEach(sheetName => {
        const worksheet = parsedExcelData.Sheets[sheetName];
        XLSX.utils.book_append_sheet(newWorkbook, worksheet, sheetName);
    });

    // Generate and add the Summary Report sheet
    const summaryData = [];
    const reportFileName = selectedMainFileName || (document.getElementById('excelFile').files[0]?.name || "N/A");

    summaryData.push(["Data Validation Summary Report"]);
    summaryData.push([`For File: ${reportFileName}`]);
    summaryData.push([`Generated On: ${new Date().toLocaleString()}`]);
    summaryData.push([]); // Blank row for spacing

    let totalIssuesIdentified = 0;
    let totalIssuesOverridden = 0;
    let totalIssuesAfterOverride = 0;

    const overrideCheckboxes = document.querySelectorAll('.override-checkbox');
    const overriddenColumns = {};
    overrideCheckboxes.forEach(checkbox => {
        if (checkbox.checked) {
            const sheet = checkbox.dataset.sheet;
            const column = checkbox.dataset.column;
            if (!overriddenColumns[sheet]) {
                overriddenColumns[sheet] = {};
            }
            overriddenColumns[sheet][column] = true;
        }
    });

    for (const sheetName in analysisResults) {
        const sheetIssues = analysisResults[sheetName];
        const sheetHeader = parsedExcelData.Sheets[sheetName] ? XLSX.utils.sheet_to_json(parsedExcelData.Sheets[sheetName], { header: 1 })[0] : [];

        summaryData.push([]); // Blank row for spacing between sheets
        summaryData.push([`Sheet: ${sheetName}`]);
        summaryData.push(["Column Name", "Blank Cells", "\"NULL\" Strings", "Future Dates", "Custom Validation Issues", "Total Issues (Column)", "Status (After Override)"]);

        let sheetTotalIssuesIdentified = 0;
        let sheetTotalIssuesOverridden = 0;
        let sheetTotalIssuesAfterOverride = 0;

        sheetHeader.forEach(colName => {
            const cleanedColName = String(colName).trim();
            const isOverridden = overriddenColumns[sheetName] && overriddenColumns[sheetName][cleanedColName];

            const blankCount = issues.blankCells[cleanedColName] || 0;
            const nullCount = issues.nullStrings[cleanedColName] || 0;
            const futureDateCount = issues.futureDates[cleanedColName] || 0;
            const customIssueCount = (issues.customValidation[cleanedColName] || []).length;

            const columnIssuesIdentified = blankCount + nullCount + futureDateCount + customIssueCount;
            sheetTotalIssuesIdentified += columnIssuesIdentified;

            let columnIssuesAfterOverride = columnIssuesIdentified;
            let statusText = 'PASS';

            if (isOverridden) {
                columnIssuesAfterOverride = 0;
                sheetTotalIssuesOverridden += columnIssuesIdentified;
                statusText = 'OVERRIDDEN';
            } else if (columnIssuesIdentified > 0) {
                statusText = 'FAIL';
            }
            sheetTotalIssuesAfterOverride += columnIssuesAfterOverride;

            summaryData.push([
                cleanedColName,
                blankCount,
                nullCount,
                futureDateCount,
                customIssueCount,
                columnIssuesIdentified,
                statusText
            ]);
        });

        summaryData.push([]); // Blank row after column details
        summaryData.push([`Total Issues Identified for Sheet (${sheetName}):`, sheetTotalIssuesIdentified]);
        summaryData.push([`Total Issues Overridden for Sheet (${sheetName}):`, sheetTotalIssuesOverridden]);
        summaryData.push([`Total Issues Remaining for Sheet (${sheetName}):`, sheetTotalIssuesAfterOverride]);
        summaryData.push([`Sheet Overall Status (After Override):`, sheetTotalIssuesAfterOverride === 0 ? 'PASS' : 'FAIL']);

        totalIssuesIdentified += sheetTotalIssuesIdentified;
        totalIssuesOverridden += sheetTotalIssuesOverridden;
        totalIssuesAfterOverride += sheetTotalIssuesAfterOverride;
    }

    summaryData.push([]); // Blank row before overall summary
    summaryData.push(["Overall File Summary"]);
    summaryData.push(["Grand Total Issues Identified:", totalIssuesIdentified]);
    summaryData.push(["Grand Total Issues Overridden:", totalIssuesOverridden]);
    summaryData.push(["Grand Total Issues Remaining (After Override):", totalIssuesAfterOverride]);
    summaryData.push(["Overall File Status (After Override):", totalIssuesAfterOverride === 0 ? 'PASS' : 'FAIL']);

    const summaryWs = XLSX.utils.aoa_to_sheet(summaryData);
    XLSX.utils.book_append_sheet(newWorkbook, summaryWs, "Validation Summary");

    const outputFileName = `Validation_Report_${reportFileName.replace(/\.(xlsx|xls|csv)$/, '')}_${new Date().toISOString().slice(0, 10)}.xlsx`;
    XLSX.writeFile(newWorkbook, outputFileName);
}

// --- Event Listeners and Initial Load ---
document.addEventListener('DOMContentLoaded', async () => {
    const userData = await verifyToken();
    if (userData) {
        setupNavigation(userData);
        populateSelects(); // Call function to populate both dropdowns
    }

    // Event Listeners for main file selection
    document.getElementById('loadMainFileBtn').addEventListener('click', loadMainFile);
    document.getElementById('excelFile').addEventListener('change', () => {
        document.getElementById('mainFileSelect').value = ''; // Clear server select
        selectedMainFileBlob = null; // Clear server-loaded blob
        selectedMainFileName = null; // Clear server-loaded name
        displayMessage('mainFileStatus', '', 'info'); // Clear any previous status
    });
    document.getElementById('mainFileSelect').addEventListener('change', () => {
        document.getElementById('excelFile').value = ''; // Clear local file input
    });

    // Event Listeners for data dictionary selection and analysis
    document.getElementById('loadDataDictionaryBtn').addEventListener('click', loadDataDictionary);
    document.getElementById('analyzeFileBtn').addEventListener('click', analyzeFile);
});
