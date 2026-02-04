const { FILTER_TAXONOMY } = require('./shared/taxonomy/filter-taxonomy.js');

let categoriesCount = 0;
let filtersCount = 0;
let optionsCount = 0;

const categories = Object.keys(FILTER_TAXONOMY);
categoriesCount = categories.length;

categories.forEach(categoryName => {
    const category = FILTER_TAXONOMY[categoryName];
    const filters = Object.keys(category);
    filtersCount += filters.length;

    filters.forEach(filterName => {
        const filter = category[filterName];
        if (filter.options && Array.isArray(filter.options)) {
            optionsCount += filter.options.length;
        }
    });
});

console.log('Categories:', categoriesCount);
console.log('Filters:', filtersCount);
console.log('Options:', optionsCount);
console.log('Total Individual Choices (Filters + Options):', filtersCount + optionsCount);
console.log('Total Interactive Elements (Categories + Filters + Options):', categoriesCount + filtersCount + optionsCount);
