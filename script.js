document.addEventListener('DOMContentLoaded', () => {
    const mainSheetUrl = '벽람 대사+스킨 도감(25/09/09)_배포용 - 메인시트.csv';
    const databaseUrl = '벽람 대사+스킨 도감(25/09/09)_배포용 - 클뜯 원본데이터 1차가공.csv';

    async function fetchCSV(url) {
        const response = await fetch(url);
        const text = await response.text();
        return text;
    }

    function parseCSV(text) {
        const lines = text.trim().split('\n').map(line => line.split(','));
        const headers = lines[0];
        const data = lines.slice(1).map(line => {
            const row = {};
            headers.forEach((header, i) => {
                row[header.trim()] = line[i] ? line[i].trim() : '';
            });
            return row;
        });
        return { headers, data };
    }

    function renderTable(data, elementId) {
        const container = document.getElementById(elementId);
        if (!container) return;

        container.innerHTML = '';
        if (data.length === 0) {
            container.innerHTML = '<p>No data available.</p>';
            return;
        }

        const table = document.createElement('table');
        const thead = document.createElement('thead');
        const tbody = document.createElement('tbody');

        // Headers
        const headerRow = document.createElement('tr');
        Object.keys(data[0]).forEach(headerText => {
            const th = document.createElement('th');
            th.textContent = headerText;
            headerRow.appendChild(th);
        });
        thead.appendChild(headerRow);
        table.appendChild(thead);

        // Data rows
        data.forEach(rowData => {
            const row = document.createElement('tr');
            Object.values(rowData).forEach(cellData => {
                const td = document.createElement('td');
                td.textContent = cellData;
                row.appendChild(td);
            });
            tbody.appendChild(row);
        });
        table.appendChild(tbody);
        container.appendChild(table);
    }

    async function loadData() {
        try {
            // Load main sheet data
            const mainSheetText = await fetchCSV(mainSheetUrl);
            const { data: mainSheetData } = parseCSV(mainSheetText);
            
            // Load database data
            const databaseText = await fetchCSV(databaseUrl);
            const { data: databaseData } = parseCSV(databaseText);

            // You can process and display the data as needed here
            // For example, display the main sheet data in a table
            renderTable(mainSheetData, 'mainSheetData');
            
            // Or you can create a function to search the database and display results
            // This is a basic example showing how to display both tables
            renderTable(databaseData, 'databaseData');

        } catch (error) {
            console.error('Error fetching or parsing CSV files:', error);
            document.getElementById('mainSheetData').innerHTML = '<p>Error loading data. Please check file names and paths.</p>';
        }
    }

    loadData();
});
