// public/tools/validation-engine.js

// --- Global Variables to store parsed data and rules ---
let parsedExcelData = null; // Stores the parsed data from the main Excel file
let parsedDataDictionary = null; // Stores parsed data from the selected data dictionary (if any)
let validationRules = {}; // Stores validation rules extracted from the data dictionary
let analysisResults = {}; // Stores the results of the analysis for each sheet

// Stores the selected main file (from server or local)
let selectedMainFileBlob = null;
let selectedMainFileName = null;


// --- Helper Functions ---

/**
 * Displays the loading spinner and disables the analyze button.
 */
function showLoader() {
    document.getElementById('loader').style.display = 'block';
    document.getElementById('results').classList.add('hidden');
    document.getElementById('summaryReportContainer').style.display = 'none';
    document.getElementById('analyzeFileBtn').disabled = true;
}

/**
 * Hides the loading spinner and enables the analyze button.
 */
function hideLoader() {
    document.getElementById('loader').style.display = 'none';
    document.getElementById('analyzeFileBtn').disabled = false;
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
        element.classList.remove('hidden'); // Ensure message is visible
    }
}

// --- Authentication and Navigation (common to all protected pages) ---

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
    if (profileLink && userData) {
        profileLink.textContent = `Hello, ${userData.username}`;
        // Set a proper profile page URL if you have one
        profileLink.href = '#'; // Placeholder
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

// --- File Selection from Server (for both main file and data dictionary) ---

/**
 * Fetches the list of uploaded files from the backend and populates both
 * the main file select dropdown and the data dictionary select dropdown.
 */
async function populateFileSelects() {
    const token = localStorage.getItem('jwtToken');
    if (!token) return;

    try {
        const response = await fetch('/api/list-files', {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!response.ok) {
            console.error('Failed to fetch files:', response.statusText, response.status);
            alert('Failed to load uploaded files. Please try again later.');
            return;
        }

        // Access the 'files' array from the response object as per list-files.js
        const responseBody = await response.json();
        const files = responseBody.files;

        console.log('Files received from /api/list-files:', files); // Still good to log this!

        const mainFileSelect = document.getElementById('mainFileSelect');
        const dataDictionarySelect = document.getElementById('dataDictionarySelect');

        // Clear existing options
        mainFileSelect.innerHTML = '<option value="">-- Select a File --</option>';
        dataDictionarySelect.innerHTML = '<option value="">-- No Data Dictionary Selected --</option>';

        let hasMainFiles = false;
        let hasDataDictionaries = false;

        files.forEach(file => {
            console.log('Processing file object:', file);
            console.log('file.id:', file.id);
            console.log('file.filename (from backend):', file.filename, typeof file.filename);
            console.log('file.is_data_dictionary:', file.is_data_dictionary, typeof file.is_data_dictionary);

            // Check if filename is NOT a string or is empty
            if (typeof file.filename !== 'string' || !file.filename.trim()) {
                console.warn('Skipping file due to invalid filename:', file);
                return; // Skip this file if filename is problematic
            }

            const optionMain = document.createElement('option');
            optionMain.value = file.id;
            optionMain.textContent = file.filename; // Use file.filename as returned by list-files.js
            mainFileSelect.appendChild(optionMain);
            hasMainFiles = true;

            // Explicitly check for boolean true
            if (file.is_data_dictionary === true) {
                const optionDict = document.createElement('option');
                optionDict.value = file.id;
                optionDict.textContent = file.filename; // Use file.filename here too
                dataDictionarySelect.appendChild(optionDict);
                hasDataDictionaries = true;
            }
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
        console.error('Error populating file selects:', error);
        alert('An error occurred while populating file lists.');
    }
}

/**
 * Loads the selected main Excel/CSV file from the server into a Blob for client-side processing.
 */
async function loadMainFile() {
    const selectedFileId = document.getElementById('mainFileSelect').value;
    if (!selectedFileId) {
        displayMessage('mainFileStatus', 'Please select a file to load.', 'error');
        selectedMainFileBlob = null;
        selectedMainFileName = null;
        return;
    }

    displayMessage('mainFileStatus', 'Loading selected file...', 'info');
    const token = localStorage.getItem('jwtToken');

    try {
        const response = await fetch(`/api/get-file?id=${selectedFileId}`, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        selectedMainFileBlob = await response.blob(); // Store the file as a Blob
        selectedMainFileName = document.getElementById('mainFileSelect').options[document.getElementById('mainFileSelect').selectedIndex].text;
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
 * Loads the selected data dictionary file from the server into a Blob,
 * parses it, and extracts validation rules.
 */
async function loadDataDictionary() {
    const selectedDictId = document.getElementById('dataDictionarySelect').value;
    if (!selectedDictId) {
        displayMessage('dataDictionaryStatus', 'Please select a data dictionary.', 'error');
        parsedDataDictionary = null;
        validationRules = {};
        return;
    }

    displayMessage('dataDictionaryStatus', 'Loading data dictionary...', 'info');
    const token = localStorage.getItem('jwtToken');

    try {
        const response = await fetch(`/api/get-file?id=${selectedDictId}`, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const blob = await response.blob();
        const reader = new FileReader();

        reader.onload = function(e) {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });

                if (workbook.SheetNames.includes("Validation Rules")) {
                    const validationSheet = workbook.Sheets["Validation Rules"];
                    parsedDataDictionary = XLSX.utils.sheet_to_json(validationSheet, { header: 1 });
                    extractValidationRules(parsedDataDictionary);
                    displayMessage('dataDictionaryStatus', `Data dictionary loaded: ${document.getElementById('dataDictionarySelect').options[document.getElementById('dataDictionarySelect').selectedIndex].text}`, 'success');
                } else {
                    displayMessage('dataDictionaryStatus', 'Data dictionary does not contain a "Validation Rules" sheet.', 'error');
                    parsedDataDictionary = null;
                    validationRules = {};
                }
            } catch (error) {
                console.error('Error parsing data dictionary file:', error);
                displayMessage('dataDictionaryStatus', 'Error parsing data dictionary. Please check its format.', 'error');
                parsedDataDictionary = null;
                validationRules = {};
            }
        };
        reader.readAsArrayBuffer(blob);

    } catch (error) {
        console.error('Error fetching data dictionary:', error);
        displayMessage('dataDictionaryStatus', 'Failed to load data dictionary. Please try again.', 'error');
        parsedDataDictionary = null;
        validationRules = {};
    }
}

/**
 * Extracts validation rules from the parsed data dictionary sheet.
 * Assumes the first row contains headers like "Column Name", "Validation Type", "Validation Value", "Failure Message".
 * @param {Array<Array<any>>} dataDictionarySheet - The sheet data as an array of arrays.
 */
function extractValidationRules(dataDictionarySheet) {
    validationRules = {}; // Reset rules
    if (!dataDictionarySheet || dataDictionarySheet.length < 2) {
        console.warn("Data dictionary sheet is empty or has no rules.");
        return; // Need at least header and one rule
    }

    const headers = dataDictionarySheet[0];
    const rulesData = dataDictionarySheet.slice(1);

    rulesData.forEach(row => {
        const rule = {};
        headers.forEach((header, index) => {
            rule[header.trim()] = row[index];
        });

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

/**
 * Analyzes the selected Excel/CSV file (either local or server-loaded)
 * against standard and custom validation rules.
 */
async function analyzeFile() {
    const localExcelFile = document.getElementById('excelFile').files[0];

    let fileToAnalyze = null;
    let fileName = null;

    // Determine which file to analyze: local file or server-loaded file
    if (localExcelFile) {
        fileToAnalyze = localExcelFile;
        fileName = localExcelFile.name;
        // Optionally clear server-loaded file state if a local one is chosen
        document.getElementById('mainFileSelect').value = ''; // Clear server select
        selectedMainFileBlob = null;
        selectedMainFileName = null;
        displayMessage('mainFileStatus', '', 'info'); // Clear any previous server file status
    } else if (selectedMainFileBlob) {
        fileToAnalyze = selectedMainFileBlob;
        fileName = selectedMainFileName;
        // Clear local file input if a server file is chosen
        document.getElementById('excelFile').value = '';
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
                            // Convert OLE Automation date (days since 1899-12-30) to JS date (milliseconds since 1970-01-01)
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
                            } catch (e) {
                                // Not a valid date string, ignore as a future date issue
                            }
                        }
                    });
                });

                // --- Duplicate Rows ---
                const rowHashes = new Set();
                const duplicateRows = [];
                sheetData.forEach((row, index) => {
                    const rowString = JSON.stringify(row); // Simple string representation of row for hashing
                    if (rowHashes.has(rowString)) {
                        duplicateRows.push(index + 2); // Excel row number (header + 1-indexed data)
                        totalDuplicateRows++;
                    } else {
                        rowHashes.add(rowString);
                    }
                });
                currentSheetIssues.duplicateRows = duplicateRows;


                // --- Custom Validation from Data Dictionary ---
                if (parsedDataDictionary && Object.keys(validationRules).length > 0) {
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
                                        case 'UNIQUE':
                                            // Handle UNIQUE separately after collecting all column values
                                            if (cellValue !== undefined && cellValue !== null && String(cellValue).trim() !== '') {
                                                const lowerCaseVal = String(cellValue).trim().toLowerCase();
                                                if (uniqueColumnValues.has(lowerCaseVal)) {
                                                    // Only add if not already marked as duplicate in this rule
                                                    const alreadyFlagged = uniqueDuplicates.some(issue =>
                                                        issue.row === issueDetails.row && issue.value === issueDetails.value
                                                    );
                                                    if (!alreadyFlagged) {
                                                        uniqueDuplicates.push({
                                                            row: issueDetails.row,
                                                            value: cellValue,
                                                            message: `Value '${cellValue}' in column '${columnName}' is not unique.`,
                                                            ruleType: 'UNIQUE'
                                                        });
                                                    }
                                                } else {
                                                    uniqueColumnValues.add(lowerCaseVal);
                                                }
                                            }
                                            break;
                                        default:
                                            console.warn(`Unknown validation type: ${ruleType} for column ${columnName}. Skipping.`);
                                            isValid = true; // Assume valid for unknown rules
                                    }

                                    if (!isValid && ruleType !== 'UNIQUE') { // UNIQUE handled separately
                                        currentSheetIssues.customValidation[columnName].push(issueDetails);
                                    }
                                });
                            });

                            // Add collected UNIQUE violations
                            if (uniqueDuplicates.length > 0) {
                                currentSheetIssues.customValidation[columnName] = currentSheetIssues.customValidation[columnName].concat(uniqueDuplicates);
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


/**
 * Displays the analysis results for a single sheet, including counts and an override table.
 * @param {string} sheetName - The name of the Excel sheet.
 * @param {object} issues - The issues found in the sheet.
 * @param {Array<string>} header - The column headers of the sheet.
 */
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

/**
 * Generates and displays a comprehensive summary report based on the analysis results
 * and the user's override selections.
 */
function generateSummaryReport() {
    const summaryContainer = document.getElementById('summaryReportContainer');
    summaryContainer.innerHTML = ''; // Clear previous report
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

    // Get all override checkboxes' states
    const overrideCheckboxes = document.querySelectorAll('.override-checkbox');
    const overriddenColumns = {}; // { sheetName: { columnName: true } }
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
        // Ensure parsedExcelData.Sheets[sheetName] exists before accessing
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

            const blankCount = sheetIssues.blankCells[cleanedColName] || 0;
            const nullCount = sheetIssues.nullStrings[cleanedColName] || 0;
            const futureDateCount = sheetIssues.futureDates[cleanedColName] || 0;
            const customIssueCount = (sheetIssues.customValidation[cleanedColName] || []).length;

            const columnIssuesIdentified = blankCount + nullCount + futureDateCount + customIssueCount;
            sheetTotalIssuesIdentified += columnIssuesIdentified;

            let columnIssuesAfterOverride = columnIssuesIdentified;
            let statusClass = 'status-pass';
            let statusText = 'PASS';

            if (isOverridden) {
                columnIssuesAfterOverride = 0; // All issues in this column are ignored
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

        // Add sheet-level summary
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

/**
 * Exports the original Excel data along with a new sheet containing the validation summary report
 * to a new Excel file downloadable by the user.
 */
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

            const blankCount = sheetIssues.blankCells[cleanedColName] || 0;
            const nullCount = sheetIssues.nullStrings[cleanedColName] || 0;
            const futureDateCount = sheetIssues.futureDates[cleanedColName] || 0;
            const customIssueCount = (sheetIssues.customValidation[cleanedColName] || []).length;

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
    // 1. Verify user's authentication token
    const userData = await verifyToken();
    if (userData) {
        // 2. Set up navigation links (e.g., profile name, logout)
        setupNavigation(userData);
        // 3. Populate both file selection dropdowns from the server
        populateFileSelects();
    }

    // 4. Attach event listeners to buttons and file inputs
    document.getElementById('analyzeFileBtn').addEventListener('click', analyzeFile);
    document.getElementById('loadDataDictionaryBtn').addEventListener('click', loadDataDictionary);
    document.getElementById('loadMainFileBtn').addEventListener('click', loadMainFile); // Listener for loading main file from server

    // 5. Add listeners to clear the other input method if one is used
    // This prevents conflicting file selections (e.g., selecting a local file AND a server file)
    document.getElementById('excelFile').addEventListener('change', () => {
        // Clear server-loaded file state when a local file is selected
        document.getElementById('mainFileSelect').value = '';
        selectedMainFileBlob = null;
        selectedMainFileName = null;
        displayMessage('mainFileStatus', '', 'info'); // Clear status message for server file
    });

    document.getElementById('mainFileSelect').addEventListener('change', () => {
        // Clear local file input when a server file is selected from the dropdown
        document.getElementById('excelFile').value = '';
        // If a server file is selected, clear its associated status message
        displayMessage('excelFileStatus', '', 'info'); // Assuming you had a status message for local file input
    });
});
