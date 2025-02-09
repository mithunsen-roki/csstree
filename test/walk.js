var assert = require('assert');
var path = require('path');
var parse = require('../lib').parse;
var walk = require('../lib').walk;
var testFiles = require('./fixture/parse').tests;
var forEachParseTest = require('./fixture/parse').forEachTest;
var testWithRules = Object.keys(testFiles).map(function(filename) {
    var dir = path.basename(path.dirname(filename));
    if (dir === 'atrule' || dir === 'rule' || dir === 'stylesheet') {
        return testFiles[filename];
    };
}).filter(Boolean);

function expectedWalk(ast, enter, leave, checker) {
    function walk(node) {
        if (enter && checker(stack, node)) {
            result.push(node.type);
        }

        stack.push(node);
        Object.keys(node).forEach(function(key) {
            if (Array.isArray(node[key])) {
                node[key].forEach(walk);
            } else if (node[key] && typeof node[key] === 'object') {
                walk(node[key]);
            }
        });
        stack.pop();

        if (leave && checker(stack, node)) {
            result.push(node.type);
        }
    }

    var result = [];
    var stack = [];

    if (!checker) {
        checker = Boolean;
    }

    walk(ast);

    return result;
}

function createWalkTest(name, test, context, walker, enter, leave) {
    (test.skip ? it.skip : it)(name, function() {
        var actual = [];
        var ast = parse(test.source, test.options);

        walker(ast, function(node) {
            actual.push(node.type);
        });

        // type arrays should be equal
        assert.deepEqual(
            actual,
            expectedWalk(test.ast, enter, leave)
        );
    });
}

function createWalkVisitTest(test, visitType, walker) {
    (test.skip ? it.skip : it)(test.name, function() {
        var actual = [];
        var ast = parse(test.source, test.options);

        walker(ast, function(node) {
            actual.push(node.type);
        });

        // type arrays should be equal
        assert.deepEqual(
            actual.sort(),
            expectedWalk(test.ast, true, false).filter(function(type) {
                return type === visitType;
            }).sort()
        );
    });
}

function createWalkDeclarationsTest(test, context, walker) {
    (test.skip ? it.skip : it)(test.name, function() {
        var actual = [];
        var ast = parse(test.source, test.options);

        walker(ast, function(node) {
            actual.push(node.type);
        });

        // type arrays should be equal
        assert.deepEqual(
            actual.sort(),
            expectedWalk(test.ast, false, true, function(stack) {
                return stack.every(function(node) {
                    return node.type !== 'AtrulePrelude';
                });
            }).filter(function(type) {
                return type === 'Declaration';
            }).sort()
        );
    });
}

describe('AST traversal', function() {
    it('base test', function() {
        function visit() {
            var visitedTypes = {};

            walk(parse('@import url("test");@media (min-width: 200px) { .foo:nth-child(2n) { color: rgb(100%, 10%, 0%); width: calc(3px + 5%) } }'), function(node) {
                visitedTypes[node.type] = true;
            });

            return Object.keys(visitedTypes).sort();
        }

        var shouldVisitTypes = [
            'AnPlusB',
            'Atrule',
            'AtrulePrelude',
            'Block',
            'ClassSelector',
            'Declaration',
            'Dimension',
            'Function',
            'MediaFeature',
            'MediaQuery',
            'MediaQueryList',
            'Nth',
            'Operator',
            'Percentage',
            'PseudoClassSelector',
            'Rule',
            'Selector',
            'SelectorList',
            'String',
            'StyleSheet',
            'Url',
            'Value',
            'WhiteSpace'
        ];

        assert.deepEqual(visit(), shouldVisitTypes);
    });

    it('base test #2', function() {
        var ast = parse('.a { color: red }');
        var log = [];

        walk(ast, {
            enter: function(node) {
                log.push('enter ' + node.type);
            },
            leave: function(node) {
                log.push('leave ' + node.type);
            }
        });

        assert.deepEqual(log, [
            'enter StyleSheet',
            'enter Rule',
            'enter SelectorList',
            'enter Selector',
            'enter ClassSelector',
            'leave ClassSelector',
            'leave Selector',
            'leave SelectorList',
            'enter Block',
            'enter Declaration',
            'enter Value',
            'enter Identifier',
            'leave Identifier',
            'leave Value',
            'leave Declaration',
            'leave Block',
            'leave Rule',
            'leave StyleSheet'
        ]);
    });

    describe('traverse order', function() {
        var ast = parse('.a.b { foo: bar; baz: qux } .c {} @media all { .d:not(.e .f) { aa: bb; cc: dd ee } f { ff: gg } }');

        it('natural', function() {
            var visitedNames = [];
            var expected = 'a b foo bar baz qux c media all d not e f aa bb cc dd ee f ff gg'.split(' ');

            walk(ast, {
                enter: function(node) {
                    if (node.name || node.property) {
                        visitedNames.push(node.name || node.property);
                    }
                }
            });

            assert.deepEqual(
                visitedNames,
                expected
            );
        });

        it('reverse', function() {
            var visitedNames = [];
            var expected = 'media ff gg f cc ee dd aa bb not f e d all c baz qux foo bar b a'.split(' ');

            walk(ast, {
                reverse: true,
                enter: function(node) {
                    if (node.name || node.property) {
                        visitedNames.push(node.name || node.property);
                    }
                }
            });

            assert.deepEqual(
                visitedNames,
                expected
            );
        });
    });

    describe('break traverse', function() {
        var ast = parse('.a.b { foo: bar; } .c {} .a.b { foo: bar; }');
        var nodeName = function(node) {
            return node.type + (node.name || node.property ? ':' + (node.name || node.property) : '');
        };

        describe('natural order', function() {
            var expected = [
                'enter StyleSheet',
                'enter Rule',
                'enter SelectorList',
                'enter Selector',
                'enter ClassSelector:a',
                'leave ClassSelector:a',
                'enter ClassSelector:b',
                'leave ClassSelector:b',
                'leave Selector',
                'leave SelectorList',
                'enter Block',
                'enter Declaration:foo',
                'enter Value',
                'enter Identifier:bar',
                'leave Identifier:bar',
                'leave Value',
                'leave Declaration:foo',
                'leave Block',
                'leave Rule',
                'enter Rule',
                'enter SelectorList',
                'enter Selector',
                'enter ClassSelector:c'
            ];

            it('this.break', function() {
                var actual = [];
                walk(ast, {
                    enter(node) {
                        actual.push('enter ' + nodeName(node));

                        if (node.name === 'c') {
                            return this.break;
                        }
                    },
                    leave(node) {
                        actual.push('leave ' + nodeName(node));
                    }
                });
                assert.deepEqual(
                    actual,
                    expected
                );
            });

            it('walk.break', function() {
                var actual = [];
                walk(ast, {
                    enter: (node) => {
                        actual.push('enter ' + nodeName(node));

                        if (node.name === 'c') {
                            return walk.break;
                        }
                    },
                    leave(node) {
                        actual.push('leave ' + nodeName(node));
                    }
                });
                assert.deepEqual(
                    actual,
                    expected
                );
            });
        });

        describe('reverse order', function() {
            var expected = [
                'enter StyleSheet',
                'enter Rule',
                'enter Block',
                'enter Declaration:foo',
                'enter Value',
                'enter Identifier:bar',
                'leave Identifier:bar',
                'leave Value',
                'leave Declaration:foo',
                'leave Block',
                'enter SelectorList',
                'enter Selector',
                'enter ClassSelector:b',
                'leave ClassSelector:b',
                'enter ClassSelector:a',
                'leave ClassSelector:a',
                'leave Selector',
                'leave SelectorList',
                'leave Rule',
                'enter Rule',
                'enter Block',
                'leave Block',
                'enter SelectorList',
                'enter Selector',
                'enter ClassSelector:c'
            ];

            it('this.break', function() {
                var actual = [];
                walk(ast, {
                    reverse: true,
                    enter(node) {
                        actual.push('enter ' + nodeName(node));

                        if (node.name === 'c') {
                            return this.break;
                        }
                    },
                    leave(node) {
                        actual.push('leave ' + nodeName(node));
                    }
                });

                assert.deepEqual(
                    actual,
                    expected
                );
            });

            it('walk.break', function() {
                var actual = [];
                walk(ast, {
                    reverse: true,
                    enter: (node) => {
                        actual.push('enter ' + nodeName(node));

                        if (node.name === 'c') {
                            return walk.break;
                        }
                    },
                    leave(node) {
                        actual.push('leave ' + nodeName(node));
                    }
                });

                assert.deepEqual(
                    actual,
                    expected
                );
            });
        });
    });

    describe('skip node traverse', function() {
        var ast = parse('.a.b { foo: bar } @media all { selector { foo: bar } } .c.d { foo: bar }');
        var nodeName = function(node) {
            return node.type + (node.name || node.property ? ':' + (node.name || node.property) : '');
        };

        describe('natural order', function() {
            var expected = [
                'enter StyleSheet',
                'enter Rule',
                'enter SelectorList',
                'enter Selector',
                'enter ClassSelector:a',
                'leave ClassSelector:a',
                'enter ClassSelector:b',
                'leave ClassSelector:b',
                'leave Selector',
                'leave SelectorList',
                'enter Block',
                'enter Declaration:foo',
                'enter Value',
                'enter Identifier:bar',
                'leave Identifier:bar',
                'leave Value',
                'leave Declaration:foo',
                'leave Block',
                'leave Rule',
                'skip Atrule:media',
                'enter Rule',
                'enter SelectorList',
                'enter Selector',
                'enter ClassSelector:c',
                'leave ClassSelector:c',
                'enter ClassSelector:d',
                'leave ClassSelector:d',
                'leave Selector',
                'leave SelectorList',
                'enter Block',
                'enter Declaration:foo',
                'enter Value',
                'enter Identifier:bar',
                'leave Identifier:bar',
                'leave Value',
                'leave Declaration:foo',
                'leave Block',
                'leave Rule',
                'leave StyleSheet'
            ];

            it('this.skip', function() {
                var actual = [];
                walk(ast, {
                    enter(node) {
                        if (node.name === 'media') {
                            actual.push('skip ' + nodeName(node));
                            return this.skip;
                        }

                        actual.push('enter ' + nodeName(node));
                    },
                    leave(node) {
                        actual.push('leave ' + nodeName(node));
                    }
                });
                assert.deepEqual(
                    actual,
                    expected
                );
            });

            it('walk.skip', function() {
                var actual = [];
                walk(ast, {
                    enter: (node) => {
                        if (node.name === 'media') {
                            actual.push('skip ' + nodeName(node));
                            return walk.skip;
                        }

                        actual.push('enter ' + nodeName(node));
                    },
                    leave(node) {
                        actual.push('leave ' + nodeName(node));
                    }
                });
                assert.deepEqual(
                    actual,
                    expected
                );
            });
        });

        describe('reverse order', function() {
            var expected = [
                'enter StyleSheet',
                'enter Rule',
                'enter Block',
                'enter Declaration:foo',
                'enter Value',
                'enter Identifier:bar',
                'leave Identifier:bar',
                'leave Value',
                'leave Declaration:foo',
                'leave Block',
                'enter SelectorList',
                'enter Selector',
                'enter ClassSelector:d',
                'leave ClassSelector:d',
                'enter ClassSelector:c',
                'leave ClassSelector:c',
                'leave Selector',
                'leave SelectorList',
                'leave Rule',
                'skip Atrule:media',
                'enter Rule',
                'enter Block',
                'enter Declaration:foo',
                'enter Value',
                'enter Identifier:bar',
                'leave Identifier:bar',
                'leave Value',
                'leave Declaration:foo',
                'leave Block',
                'enter SelectorList',
                'enter Selector',
                'enter ClassSelector:b',
                'leave ClassSelector:b',
                'enter ClassSelector:a',
                'leave ClassSelector:a',
                'leave Selector',
                'leave SelectorList',
                'leave Rule',
                'leave StyleSheet'
            ];

            it('this.skip', function() {
                var actual = [];
                walk(ast, {
                    reverse: true,
                    enter(node) {
                        if (node.name === 'media') {
                            actual.push('skip ' + nodeName(node));
                            return this.skip;
                        }

                        actual.push('enter ' + nodeName(node));
                    },
                    leave(node) {
                        actual.push('leave ' + nodeName(node));
                    }
                });

                assert.deepEqual(
                    actual,
                    expected
                );
            });

            it('walk.skip', function() {
                var actual = [];
                walk(ast, {
                    reverse: true,
                    enter: (node) => {
                        if (node.name === 'media') {
                            actual.push('skip ' + nodeName(node));
                            return walk.skip;
                        }

                        actual.push('enter ' + nodeName(node));
                    },
                    leave(node) {
                        actual.push('leave ' + nodeName(node));
                    }
                });

                assert.deepEqual(
                    actual,
                    expected
                );
            });
        });
    });


    describe('bad options', function() {
        var ast = parse('.foo { color: red }');

        it('should throws when no enter/leave handlers is set', function() {
            assert.throws(function() {
                walk(ast);
            }, /Neither `enter` nor `leave` walker handler is set or both aren't a function/);

            assert.throws(function() {
                walk(ast, {});
            }, /Neither `enter` nor `leave` walker handler is set or both aren't a function/);
        });

        it('should throws when visit has wrong value', function() {
            assert.throws(function() {
                walk(ast, { visit: 'Foo' });
            }, /Bad value `Foo` for `visit` option \(should be: AnPlusB, Atrule, AtrulePrelude, AttributeSelector, Block, Brackets, CDC, CDO, ClassSelector, Combinator, Comment, Declaration, DeclarationList, Dimension, Function, Hash, Identifier, IdSelector, MediaFeature, MediaQuery, MediaQueryList, Nth, Number, Operator, Parentheses, Percentage, PseudoClassSelector, PseudoElementSelector, Ratio, Raw, Rule, Selector, SelectorList, String, StyleSheet, TypeSelector, UnicodeRange, Url, Value, WhiteSpace\)/);
        });
    });

    describe('walk(ast, fn)', function() {
        forEachParseTest(function(name, test, context) {
            createWalkTest(name, test, context, walk, true, false);
        });
    });

    describe('walk(ast, { leave: fn })', function() {
        forEachParseTest(function(name, test, context) {
            createWalkTest(name, test, context, function(ast, fn) {
                walk(ast, { leave: fn });
            }, false, true);
        });
    });

    describe('walk(ast, { visit: \'Rule\' })', function() {
        testWithRules.forEach(function(file) {
            Object.keys(file.tests).forEach(function(name) {
                createWalkVisitTest(file.tests[name], 'Rule', function(ast, fn) {
                    return walk(ast, {
                        visit: 'Rule',
                        enter: fn
                    });
                });
            });
        });
    });

    describe('walk(ast, { visit: \'Atrule\' })', function() {
        testWithRules.forEach(function(file) {
            Object.keys(file.tests).forEach(function(name) {
                createWalkVisitTest(file.tests[name], 'Atrule', function(ast, fn) {
                    return walk(ast, {
                        visit: 'Atrule',
                        enter: fn
                    });
                });
            });
        });
    });

    describe('walk(ast, { visit: \'Rule\', reverse: true })', function() {
        testWithRules.forEach(function(file) {
            Object.keys(file.tests).forEach(function(name) {
                createWalkVisitTest(file.tests[name], 'Rule', function(ast, fn) {
                    return walk(ast, {
                        visit: 'Rule',
                        reverse: true,
                        enter: fn
                    });
                });
            });
        });
    });

    describe('walk(ast, { visit: \'Number\' })', function() {
        testWithRules.forEach(function(file) {
            Object.keys(file.tests).forEach(function(name) {
                createWalkVisitTest(file.tests[name], 'Number', function(ast, fn) {
                    return walk(ast, {
                        visit: 'Number',
                        enter: fn
                    });
                });
            });
        });
    });

    describe('walk(ast, { visit: \'Declaration\' })', function() {
        testWithRules.forEach(function(file) {
            Object.keys(file.tests).forEach(function(name) {
                createWalkDeclarationsTest(file.tests[name], 'Declaration', function(ast, fn) {
                    return walk(ast, {
                        visit: 'Declaration',
                        enter: fn
                    });
                });
            });
        });

        it('iterate DeclarationList', function() {
            const ast = parse('foo: a; bar: b', { context: 'declarationList' });
            let visited = 0;

            walk(ast, {
                visit: 'Declaration',
                enter(node) {
                    if (node.type === 'Declaration') {
                        visited++;
                    }
                }
            });

            assert.equal(visited, 2);
        });
    });
});
